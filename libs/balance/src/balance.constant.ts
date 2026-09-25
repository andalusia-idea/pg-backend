import {
  BalanceBucketEnum,
  BalanceHolderTypeEnum,
  BalanceReasonEnum,
} from './balance.enum';

/**
 * The house's holder id.
 *
 * There is one internal balance, not one per provider. Our own fee income is
 * already on every `*FeeDetail` row, and legacy's per-provider running total
 * was a misleading number - narrowing `InternalBalanceLog` to one provider
 * returned the whole house balance as of that provider's last movement, never
 * that provider's share of it. A single holder keeps the admin portal's
 * "profit right now" honest.
 */
export const INTERNAL_HOLDER_ID = 0;

/** Money is `Decimal(18,2)`; anything finer is a caller bug, not a rounding job. */
export const MONEY_SCALE = 2;

/**
 * Lock-acquisition order for snapshot rows.
 *
 * There are no advisory locks here - a snapshot updated with `amount = amount +
 * delta` has no read-then-write window for one to protect. What remains is
 * ordering: two transactions touching the same set of snapshot rows in
 * different orders can deadlock on Postgres *row* locks. Sorting every
 * movement's legs the same way gives them all one acquisition order, which is
 * what legacy achieved by `.sort()`ing agent ids - without the global lock that
 * became its throughput bottleneck.
 *
 * **The values are arbitrary; only their consistency matters.** A movement that
 * has no agent leg is not a special case - a subset of a total order is still
 * ordered, so optional holders neither weaken the guarantee nor argue for a
 * particular position. Reorder these freely; just never sort by anything that
 * varies between transactions.
 *
 * The one thing worth knowing: `INTERNAL` is a **single row** - holder id
 * {@link INTERNAL_HOLDER_ID} - touched by every movement in the system, so it
 * is the most contended lock here by a wide margin. Within one movement its
 * position costs microseconds either way. Across a settlement batch it does
 * not matter at all, because the row stays locked until the transaction
 * commits regardless of where in the list it sat. What that *does* mean is
 * that batches for different merchants serialise on it - the legacy global
 * advisory lock's bottleneck arriving by a different route. Fine at this
 * volume; revisit if batch runs start waiting on each other.
 */
export const HOLDER_TYPE_ORDER: Readonly<
  Record<BalanceHolderTypeEnum, number>
> = {
  [BalanceHolderTypeEnum.MERCHANT]: 1,
  [BalanceHolderTypeEnum.INTERNAL]: 2,
  [BalanceHolderTypeEnum.AGENT]: 3,
};

export const BUCKET_ORDER: Readonly<Record<BalanceBucketEnum, number>> = {
  [BalanceBucketEnum.PENDING]: 1,
  [BalanceBucketEnum.AVAILABLE]: 2,
  [BalanceBucketEnum.RESERVED]: 3,
};

/**
 * Reasons whose legs must net to zero for every holder they touch.
 *
 * These move value *between buckets* without changing what a holder is owed in
 * total, so a non-zero sum means the movement lost or invented money on the way
 * across. Asserting it at the point the movement is built catches most
 * arithmetic mistakes there, rather than in a report a month later.
 *
 * Everything else legitimately changes a total: a payin credits, a completed
 * payout debits, an adjustment does whichever it was told to.
 */
export const TRANSFER_REASONS: ReadonlySet<BalanceReasonEnum> = new Set([
  BalanceReasonEnum.MERCHANT_SETTLED,
  BalanceReasonEnum.PAYOUT_RESERVED,
  BalanceReasonEnum.PAYOUT_FAILED,
]);
