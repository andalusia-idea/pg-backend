import {
  BalanceBucketEnum,
  BalanceDirectionEnum,
  BalanceHolderTypeEnum,
  BalanceReasonEnum,
  BalanceService,
  BalanceSourceTypeEnum,
  INTERNAL_HOLDER_ID,
  type BalanceLeg,
  type BalanceMovement,
  type BalanceTx,
} from '@app/balance';
import { FeeTypeEnum, SETTLEMENT_RUNNER_USER_ID } from '@app/microservice';
import { PRISMA_MASTER_TRANSACTION_PROVIDER_KEY } from '../database';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@transaction/prisma';
import Decimal from 'decimal.js';
import { settlementCutoff } from '../policy';

/**
 * How many purchases one batch may claim.
 *
 * The cap is why a run can produce several batches. Without it a merchant with
 * 50,000 unsettled purchases would hold row locks for the length of one
 * transaction and write 300,000 balance entries in a single commit; with it,
 * each commit stays small and other pods keep working other merchants
 * meanwhile.
 */
const CLAIM_LIMIT = 500;

/** The run fields this service needs. */
export type SettlementRunTarget = {
  readonly id: number;
  readonly merchantId: number;
  readonly paymentMethodName: string;
};

export type SettleResult = {
  readonly batches: number;
  readonly claimed: number;
};

/** One row the claim handed back. Amounts arrive as text - see `claimBatch`. */
type ClaimedRow = {
  id: number;
  paidAt: Date;
  nominal: string;
  netNominal: string;
};

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @Inject(PRISMA_MASTER_TRANSACTION_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    private readonly balanceService: BalanceService,
  ) {}

  /**
   * Settle everything ripe for one run.
   *
   * Loops one batch at a time, **each in its own transaction**, until a claim
   * comes back under the cap. Partial progress is the point rather than a
   * compromise: a crash between batches leaves the finished ones committed and
   * their purchases non-NULL, so the sweeper's retry claims only the remainder.
   *
   * Claiming nothing is the normal outcome. Most runs for most merchants find
   * nothing ripe, and that is a `DONE` run with no batch, not an error.
   */
  async settle(
    run: SettlementRunTarget,
    now = new Date(),
  ): Promise<SettleResult> {
    const cutoff = await this.resolveCutoff(run, now);

    if (!cutoff) {
      this.logger.log({
        msg: 'nothing ripe for this run',
        runId: run.id,
        merchantId: run.merchantId,
      });

      return { batches: 0, claimed: 0 };
    }

    let batches = 0;
    let claimed = 0;

    for (;;) {
      const count = await this.settleOneBatch(run, cutoff);
      if (count === 0) break;

      batches += 1;
      claimed += count;

      // Under the cap means the claim exhausted what was ripe.
      if (count < CLAIM_LIMIT) break;
    }

    this.logger.log({
      msg: 'run settled',
      runId: run.id,
      merchantId: run.merchantId,
      batches,
      claimed,
    });

    return { batches, claimed };
  }

  /**
   * One batch: claim, post the movements, record the totals. One transaction.
   *
   * The ordering is forced and worth stating, because the obvious reading of
   * Step 10 is impossible: the claim writes `batchSettlementId`, so the batch
   * row has to exist before the claim can name it. Insert it with zero totals,
   * claim against its id, then correct the totals once they are known. Nothing
   * outside this transaction ever observes the zero state.
   */
  private async settleOneBatch(
    run: SettlementRunTarget,
    cutoff: Date,
  ): Promise<number> {
    return this.prismaMaster.$transaction(async (tx) => {
      const batch = await tx.settlementBatch.create({
        data: { runId: run.id },
        select: { id: true },
      });

      const rows = await this.claimBatch(tx, run, cutoff, batch.id);

      if (rows.length === 0) {
        // Returning from inside `$transaction` COMMITS - it does not roll back.
        // Without this delete, every quiet tick would leave a zero-row batch,
        // and most ticks are quiet.
        await tx.settlementBatch.delete({ where: { id: batch.id } });

        return 0;
      }

      const fees = await this.feeLegsByPurchase(tx, rows);

      let gross = new Decimal(0);
      let net = new Decimal(0);

      for (const row of rows) {
        const movement = this.buildSettlementMovement(run, row, batch.id, fees);
        await this.balanceService.post(tx, movement);

        gross = gross.plus(row.nominal);
        net = net.plus(row.netNominal);
      }

      const paidAts = rows.map((row) => row.paidAt.getTime());

      await tx.settlementBatch.update({
        where: { id: batch.id },
        data: {
          transactionCount: rows.length,
          grossAmount: gross,
          netAmount: net,
          // Everything the holders did not receive: provider cut plus the
          // merchant's own fee. Derived rather than summed from the detail
          // rows, so it cannot disagree with the two totals beside it.
          feeAmount: gross.minus(net),
          // Descriptive, derived from what was claimed. Never used to select -
          // the claim selects on `batchSettlementId IS NULL`, never a range.
          sweptFrom: new Date(Math.min(...paidAts)),
          sweptTo: new Date(Math.max(...paidAts)),
        },
      });

      return rows.length;
    });
  }

  /**
   * Take up to `CLAIM_LIMIT` ripe purchases for this merchant, atomically.
   *
   * Raw SQL because the whole point is one statement: selecting candidates and
   * then updating them from JavaScript reopens the window two pods could both
   * pass through.
   *
   * Four things in here are deliberate:
   *
   * - **Every identifier is quoted.** No `@map` in this repo, so the table is
   *   `"PurchaseTransaction"` with camelCase columns, and Postgres folds
   *   anything unquoted to lower case.
   * - **Amounts come back as `text`.** `::text` with a quoted alias, parsed into
   *   `Decimal` here, rather than trusting how the driver renders `numeric`.
   * - **`updatedAt` / `updatedBy` are set by hand.** `PurchaseTransaction` is in
   *   `AUDITED_MODELS`, but the audit extension hooks the model API and cannot
   *   see raw SQL, so without this the claim would leave both stale.
   * - **A purchase with no fee detail is not claimed.** `PAYIN_CAPTURED`
   *   credited such a purchase's *gross* to the merchant, with no internal or
   *   agent legs, so settling it from the fee rows would move an amount that
   *   was never in `PENDING`. Leaving it unclaimed delays that merchant; the
   *   alternative over-credits them, and an over-credit can be withdrawn.
   */
  private async claimBatch(
    tx: BalanceTx,
    run: SettlementRunTarget,
    cutoff: Date,
    batchId: number,
  ): Promise<ClaimedRow[]> {
    const rows = await tx.$queryRaw<ClaimedRow[]>`
      UPDATE "transaction"."PurchaseTransaction"
      SET "batchSettlementId" = ${batchId},
          "settlementAt"      = now(),
          "updatedAt"         = now(),
          "updatedBy"         = ${SETTLEMENT_RUNNER_USER_ID}
      WHERE "id" IN (
        SELECT p."id"
        FROM "transaction"."PurchaseTransaction" p
        WHERE p."merchantId" = ${run.merchantId}
          AND p."status" = 'SUCCESS'
          AND p."batchSettlementId" IS NULL
          AND p."deletedAt" IS NULL
          AND p."paidAt" < ${cutoff}
          AND (${run.paymentMethodName} = '*'
              OR p."paymentMethodName" = ${run.paymentMethodName})
          AND EXISTS (
            SELECT 1 FROM "transaction"."PurchaseFeeDetail" fd
            WHERE fd."purchaseId" = p."id" AND fd."deletedAt" IS NULL
          )
        ORDER BY p."paidAt"
        LIMIT ${CLAIM_LIMIT}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id",
                "paidAt",
                "nominal"::text    AS "nominal",
                "netNominal"::text AS "netNominal"
    `;

    return rows;
  }

  /**
   * The internal and agent legs for each claimed purchase, from the fee rows
   * written when the payment was captured.
   *
   * **The merchant is not in here.** A `MERCHANT` fee row holds the fee
   * *charged* to the merchant, not what they received - that is
   * `PurchaseTransaction.netNominal`, which is what `PAYIN_CAPTURED` credited.
   * Reading the merchant's share from the fee rows would move the wrong amount
   * and leave a residue in `PENDING` forever.
   *
   * **`PROVIDER` rows get no leg either.** MotionPay deducts their cut upstream,
   * so it never landed in a balance we track.
   */
  private async feeLegsByPurchase(
    tx: BalanceTx,
    rows: readonly ClaimedRow[],
  ): Promise<Map<number, { internal: Decimal; agents: Map<number, Decimal> }>> {
    const details = await tx.purchaseFeeDetail.findMany({
      where: {
        purchaseId: { in: rows.map((row) => row.id) },
        deletedAt: null,
        type: { in: [FeeTypeEnum.INTERNAL, FeeTypeEnum.AGENT] },
      },
      select: { purchaseId: true, type: true, agentId: true, nominal: true },
    });

    const byPurchase = new Map<
      number,
      { internal: Decimal; agents: Map<number, Decimal> }
    >();

    for (const row of rows) {
      byPurchase.set(row.id, { internal: new Decimal(0), agents: new Map() });
    }

    for (const detail of details) {
      const entry = byPurchase.get(detail.purchaseId);
      if (!entry) continue;

      const nominal = new Decimal(detail.nominal.toString());

      if (detail.type === FeeTypeEnum.INTERNAL) {
        entry.internal = entry.internal.plus(nominal);
        continue;
      }

      if (detail.agentId === null) {
        // An AGENT fee with nobody to credit. Refusing is the only safe answer:
        // crediting it to anyone else is inventing a recipient, and dropping it
        // silently leaves that much stranded in the agent's PENDING.
        throw new Error(
          `settlement: purchase ${detail.purchaseId} has an AGENT fee detail with no agentId.`,
        );
      }

      entry.agents.set(
        detail.agentId,
        (entry.agents.get(detail.agentId) ?? new Decimal(0)).plus(nominal),
      );
    }

    return byPurchase;
  }

  /**
   * One movement per purchase, moving every holder's share `PENDING` to
   * `AVAILABLE`.
   *
   * **One movement per purchase, not one per batch.** It is what makes
   * `BalanceEntry`'s unique key - `(holderType, holderId, bucket, reason,
   * sourceType, sourceId)` - a third line of defence: a second attempt to settle
   * purchase 123 hits `P2002` even if the run claim and the column claim were
   * both somehow bypassed. It is also what lets "what did settlement do to
   * purchase 123" stay one query.
   *
   * Two legs per holder, because `MERCHANT_SETTLED` is a transfer reason:
   * `libs/balance` asserts that such a movement nets to zero per holder, which
   * is exactly the claim that money only changed state.
   */
  private buildSettlementMovement(
    run: SettlementRunTarget,
    row: ClaimedRow,
    batchId: number,
    fees: Map<number, { internal: Decimal; agents: Map<number, Decimal> }>,
  ): BalanceMovement {
    const fee = fees.get(row.id);
    const legs: BalanceLeg[] = [];

    const transfer = (
      holderType: BalanceHolderTypeEnum,
      holderId: number,
      amount: Decimal,
    ): void => {
      if (amount.lessThanOrEqualTo(0)) return;

      legs.push(
        {
          holderType,
          holderId,
          amount,
          bucket: BalanceBucketEnum.PENDING,
          direction: BalanceDirectionEnum.DEBIT,
        },
        {
          holderType,
          holderId,
          amount,
          bucket: BalanceBucketEnum.AVAILABLE,
          direction: BalanceDirectionEnum.CREDIT,
        },
      );
    };

    // `run.merchantId`, never a merchant id echoed back from elsewhere.
    transfer(
      BalanceHolderTypeEnum.MERCHANT,
      run.merchantId,
      new Decimal(row.netNominal),
    );
    transfer(
      BalanceHolderTypeEnum.INTERNAL,
      INTERNAL_HOLDER_ID,
      fee?.internal ?? new Decimal(0),
    );

    for (const [agentId, amount] of fee?.agents ?? []) {
      transfer(BalanceHolderTypeEnum.AGENT, agentId, amount);
    }

    return {
      reason: BalanceReasonEnum.MERCHANT_SETTLED,
      sourceType: BalanceSourceTypeEnum.PURCHASE,
      sourceId: row.id,
      batchId,
      createdBy: SETTLEMENT_RUNNER_USER_ID,
      legs,
    };
  }

  /**
   * The `paidAt` cutoff for this run, or `null` when nothing is ripe.
   *
   * Resolved once per run rather than per purchase: the claim filters thousands
   * of rows with one comparison, so the policy has to collapse into a single
   * timestamp first. `settlementCutoff` is proven against `isEligible` for
   * every mode, so the two cannot disagree in the generous direction.
   */
  private async resolveCutoff(
    run: SettlementRunTarget,
    now: Date,
  ): Promise<Date | null> {
    const policy = await this.prismaMaster.merchantSettlementPolicy.findFirst({
      where: {
        merchantId: run.merchantId,
        paymentMethodName: { in: [run.paymentMethodName, '*'] },
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        deletedAt: null,
      },
      // Most specific first, then most recently effective. `false` sorts before
      // `true` in Postgres, so an exact method match beats the '*' default.
      orderBy: [{ paymentMethodName: 'desc' }, { effectiveFrom: 'desc' }],
    });

    if (!policy) {
      this.logger.warn({
        msg: 'no policy in force; skipping rather than assuming terms',
        runId: run.id,
        merchantId: run.merchantId,
      });

      return null;
    }

    const window = await this.resolveWindow(run, policy.mode, now);

    return settlementCutoff(policy, now, window ?? undefined);
  }

  /**
   * The upstream window for this run's payment method, when the policy needs
   * one.
   *
   * **Known limitation.** `SettlementRun` carries a payment method but no
   * provider, while windows are keyed by both - so this matches on method
   * alone. That is unambiguous today because MotionPay is the only integrated
   * upstream. The moment a second provider serves the same method, one run
   * cannot express two cutoffs, and this refuses rather than silently picking
   * one. Fixing it properly means the enqueuer resolving a provider per run.
   */
  private async resolveWindow(
    run: SettlementRunTarget,
    mode: string,
    now: Date,
  ) {
    if (mode !== 'FOLLOW_UPSTREAM') return null;

    if (run.paymentMethodName === '*') {
      throw new Error(
        `settlement: run ${run.id} is FOLLOW_UPSTREAM on '*', which cannot resolve ` +
          'to one window - a provider settles each method on its own schedule. ' +
          'The enqueuer must fan a FOLLOW_UPSTREAM policy out into one run per method.',
      );
    }

    const windows = await this.prismaMaster.upstreamSettlementWindow.findMany({
      where: {
        paymentMethodName: run.paymentMethodName,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        deletedAt: null,
      },
    });

    if (windows.length === 0) {
      this.logger.warn({
        msg: 'no upstream window seeded for this method; skipping',
        runId: run.id,
        paymentMethodName: run.paymentMethodName,
      });

      return null;
    }

    if (windows.length > 1) {
      throw new Error(
        `settlement: ${windows.length} upstream windows match method ` +
          `${run.paymentMethodName}; one run cannot carry two cutoffs. ` +
          'Resolve a provider per run before settling this method.',
      );
    }

    return windows[0];
  }
}
