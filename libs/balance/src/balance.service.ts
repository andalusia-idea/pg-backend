import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  BUCKET_ORDER,
  HOLDER_TYPE_ORDER,
  MONEY_SCALE,
  TRANSFER_REASONS,
} from './balance.constant';
import {
  BalanceBucketEnum,
  BalanceDirectionEnum,
  BalanceHolderTypeEnum,
  BalanceReasonEnum,
  BalanceSourceTypeEnum,
} from './balance.enum';
import {
  BalanceLeg,
  BalanceMovement,
  holderKey,
  snapshotKey,
} from './balance.movement';
import type { BalanceTx } from './balance.type';

export type ReserveParams = {
  holderType: BalanceHolderTypeEnum;
  holderId: number;
  amount: Decimal;
  sourceType: BalanceSourceTypeEnum;
  sourceId: number;
  createdBy: number;
};

export type ReserveResult =
  { ok: true } | { ok: false; reason: 'INSUFFICIENT_BALANCE' };

/**
 * Writes balance movements: immutable entries plus the snapshot they fold into.
 *
 * The one implementation, used by every app that moves money, so the legacy
 * two-writers problem cannot return in a new shape.
 *
 * **Both methods take the caller's transaction, never open their own.** The
 * entries and the snapshot must commit together with whatever caused them - a
 * payout row, a status change, a settlement batch. Splitting them is the single
 * failure this design exists to prevent.
 */
@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  /**
   * Post a movement: append its entries, fold them into the snapshot.
   *
   * Idempotent by construction. A replayed webhook, a re-run batch or a
   * double-clicked admin button hits the unique constraint on
   * `(holderType, holderId, bucket, reason, sourceType, sourceId)` and throws
   * `P2002` rather than crediting twice. Callers that expect replays - webhooks
   * especially - should catch that specific code and treat it as success.
   */
  async post(tx: BalanceTx, movement: BalanceMovement): Promise<void> {
    assertTransactionClient(tx);
    const legs = this.validate(movement);

    const entries = await tx.balanceEntry.createManyAndReturn({
      data: legs.map((leg) => ({
        holderType: leg.holderType,
        holderId: leg.holderId,
        bucket: leg.bucket,
        direction: leg.direction,
        amount: leg.amount.toFixed(MONEY_SCALE),
        reason: movement.reason,
        sourceType: movement.sourceType,
        sourceId: movement.sourceId,
        batchId: movement.batchId ?? null,
        createdBy: movement.createdBy,
      })),
      select: { id: true, holderType: true, holderId: true, bucket: true },
    });

    // Each (holder, bucket) appears at most once per movement - validate()
    // enforces it - so this mapping is exact.
    const entryIdByRow = new Map<string, bigint>(
      entries.map((entry) => [snapshotKey(entry), entry.id]),
    );

    // Sequential, in the sorted order from validate(). Doing these in parallel
    // would hand concurrent transactions different row-lock orders, which is
    // the deadlock the sort exists to prevent.
    for (const leg of legs) {
      const entryId = entryIdByRow.get(snapshotKey(leg));
      if (entryId === undefined) {
        throw new Error(
          `balance: no entry returned for ${snapshotKey(leg)} - createManyAndReturn did not round-trip every leg`,
        );
      }
      await this.applyToSnapshot(tx, leg, entryId, movement.createdBy);
    }

    this.logger.debug({
      msg: 'balance movement posted',
      reason: movement.reason,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      legs: legs.length,
    });
  }

  /**
   * Hold funds for an in-flight payout, or report that they are not there.
   *
   * Must run in the same transaction as the payout row, **before** the provider
   * is called. A credit arriving late costs nothing; a debit arriving late is
   * money already sent that was never deducted.
   *
   * The check and the lock are one statement. `SELECT ... FOR UPDATE` with the
   * amount predicate means a second concurrent request either waits and then
   * re-evaluates the predicate against the committed balance - Postgres
   * re-checks the qual after acquiring the lock under READ COMMITTED - or finds
   * no row at all. Two withdrawals for more than the balance cannot both pass,
   * which is the defect `if (balance >= amount)` in the legacy code has.
   */
  async reserve(tx: BalanceTx, params: ReserveParams): Promise<ReserveResult> {
    assertTransactionClient(tx);
    assertPositiveMoney(params.amount, 'reserve amount');

    const locked = await tx.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok
      FROM transaction."BalanceSnapshot"
      WHERE "holderType" = ${params.holderType}::transaction."BalanceHolderTypeEnum"
        AND "holderId"   = ${params.holderId}
        AND "bucket"     = 'AVAILABLE'::transaction."BalanceBucketEnum"
        AND "amount"    >= ${params.amount.toFixed(MONEY_SCALE)}::numeric
      FOR UPDATE
    `;

    if (locked.length === 0) {
      // Also the "no snapshot row yet" case: a holder who has never been
      // credited cannot pay out, which is the same answer.
      return { ok: false, reason: 'INSUFFICIENT_BALANCE' };
    }

    await this.post(tx, {
      reason: BalanceReasonEnum.PAYOUT_RESERVED,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      createdBy: params.createdBy,
      legs: [
        {
          holderType: params.holderType,
          holderId: params.holderId,
          bucket: BalanceBucketEnum.AVAILABLE,
          direction: BalanceDirectionEnum.DEBIT,
          amount: params.amount,
        },
        {
          holderType: params.holderType,
          holderId: params.holderId,
          bucket: BalanceBucketEnum.RESERVED,
          direction: BalanceDirectionEnum.CREDIT,
          amount: params.amount,
        },
      ],
    });

    return { ok: true };
  }

  /**
   * Fold one leg into its snapshot row, creating it on first touch.
   *
   * Raw SQL for two reasons Prisma's `upsert` cannot express. The increment has
   * to be `amount + EXCLUDED.amount` in the statement itself - reading the
   * balance into JavaScript and writing it back is the lost update legacy's
   * advisory locks existed to prevent. And `lastEntryId` has to be `GREATEST`:
   * two transactions can take the row lock in a different order than the
   * sequence handed out their entry ids, and a `lastEntryId` that went backwards
   * would make the nightly check in Step 4 sum too few entries and report a
   * mismatch that is not real.
   *
   * `@updatedAt` is a Prisma *client* feature, not a database trigger, so raw
   * SQL does not fire it - `updatedAt` and `updatedBy` are set explicitly here.
   */
  private async applyToSnapshot(
    tx: BalanceTx,
    leg: BalanceLeg,
    entryId: bigint,
    updatedBy: number,
  ): Promise<void> {
    const signed =
      leg.direction === BalanceDirectionEnum.CREDIT
        ? leg.amount
        : leg.amount.negated();

    await tx.$executeRaw`
      INSERT INTO transaction."BalanceSnapshot"
        ("holderType", "holderId", "bucket", "amount", "lastEntryId", "updatedAt", "updatedBy")
      VALUES (
        ${leg.holderType}::transaction."BalanceHolderTypeEnum",
        ${leg.holderId},
        ${leg.bucket}::transaction."BalanceBucketEnum",
        ${signed.toFixed(MONEY_SCALE)}::numeric,
        ${entryId},
        now(),
        ${updatedBy}
      )
      ON CONFLICT ("holderType", "holderId", "bucket") DO UPDATE SET
        "amount"      = "BalanceSnapshot"."amount" + EXCLUDED."amount",
        "lastEntryId" = GREATEST("BalanceSnapshot"."lastEntryId", EXCLUDED."lastEntryId"),
        "updatedAt"   = now(),
        "updatedBy"   = EXCLUDED."updatedBy"
    `;
  }

  /**
   * Reject a malformed movement before any of it reaches the database, and
   * return the legs in lock-acquisition order.
   */
  private validate(movement: BalanceMovement): BalanceLeg[] {
    const { legs, reason } = movement;

    if (legs.length === 0) {
      throw new Error(`balance: ${reason} movement has no legs`);
    }

    const seen = new Set<string>();
    for (const leg of legs) {
      assertPositiveMoney(leg.amount, `${reason} leg ${snapshotKey(leg)}`);

      // Two legs on one snapshot row would collide on the unique constraint
      // - the reason and source are constant across a movement, so the key
      // reduces to holder plus bucket. Failing here names the actual problem
      // instead of surfacing as an opaque P2002.
      const key = snapshotKey(leg);
      if (seen.has(key)) {
        throw new Error(
          `balance: ${reason} movement has two legs for ${key}; combine them into one`,
        );
      }
      seen.add(key);
    }

    if (TRANSFER_REASONS.has(reason)) {
      // Two passes, deliberately. A transfer's legs only balance once *all* of
      // them are counted - the first leg of a pending-to-available move nets to
      // -98,000 on its own. Checking inside the accumulation loop would reject
      // every valid transfer there is.
      const netByHolder = new Map<string, Decimal>();
      for (const leg of legs) {
        const key = holderKey(leg);
        const running = netByHolder.get(key) ?? new Decimal(0);
        netByHolder.set(
          key,
          leg.direction === BalanceDirectionEnum.CREDIT
            ? running.plus(leg.amount)
            : running.minus(leg.amount),
        );
      }

      for (const [key, net] of netByHolder) {
        if (!net.isZero()) {
          throw new Error(
            `balance: ${reason} moves value between buckets, so it must net to zero per holder, but ${key} nets ${net.toFixed(MONEY_SCALE)}`,
          );
        }
      }
    }

    return [...legs].sort(compareLegs);
  }
}

/**
 * Refuse a root client.
 *
 * `Prisma.TransactionClient` omits `$transaction`, but TypeScript allows extra
 * properties when assigning a variable, so a full `PrismaClient` still type
 * checks here. Passing one would let the entries and the snapshot commit
 * separately and silently - worth two lines to make unshippable.
 */
function assertTransactionClient(tx: BalanceTx): void {
  if ('$transaction' in tx) {
    throw new Error(
      'balance: a root PrismaClient was passed. These methods must run inside ' +
        'prisma.$transaction(...) so the entries and the snapshot commit together.',
    );
  }
}

function assertPositiveMoney(amount: Decimal, what: string): void {
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new Error(
      `balance: ${what} must be a positive amount, got ${amount.toString()}. Direction carries the sign, never the amount.`,
    );
  }

  if (amount.decimalPlaces() > MONEY_SCALE) {
    throw new Error(
      `balance: ${what} has ${amount.decimalPlaces()} decimal places, more than the ${MONEY_SCALE} the column stores. Round at the fee split, where the residual can be assigned deliberately.`,
    );
  }
}

/** Deterministic across every transaction - see HOLDER_TYPE_ORDER. */
function compareLegs(a: BalanceLeg, b: BalanceLeg): number {
  return (
    HOLDER_TYPE_ORDER[a.holderType] - HOLDER_TYPE_ORDER[b.holderType] ||
    a.holderId - b.holderId ||
    BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
  );
}
