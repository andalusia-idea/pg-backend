import { SettlementConfig } from '@app/configuration';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient, SettlementRunStatusEnum } from '@transaction/prisma';
import { PRISMA_MASTER_TRANSACTION_PROVIDER_KEY } from '../database';
import { SettlementService } from './settlement.service';

/**
 * How many runs one tick will take before it stops and waits for the next.
 *
 * Not a correctness bound - the loop terminates on its own, because claiming a
 * run sets it `RUNNING` and the claim only selects `PENDING`. It bounds how long
 * one tick can hold the process, so a thousand merchants falling due at once
 * cannot keep a single invocation working for an unbounded stretch. Whatever is
 * left is still `PENDING` and the next tick takes it.
 */
const MAX_RUNS_PER_TICK = 200;

/** The claim's result: the fields `settle()` needs, plus context for logs. */
type ClaimedRun = {
  id: number;
  merchantId: number;
  paymentMethodName: string;
  dueAt: Date;
  attempts: number;
};

@Injectable()
export class RunnerService {
  private readonly logger = new Logger(RunnerService.name);

  constructor(
    @Inject(PRISMA_MASTER_TRANSACTION_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    private readonly settlementService: SettlementService,
    private readonly settlementConfig: SettlementConfig,
  ) {}

  /**
   * Claim due runs and settle them, until there are none left.
   *
   * **One tick drains the queue; it does not do one run.** If a tick handled a
   * single run, fifty merchants due at 15:00 would take fifty ticks - most of
   * an hour at this cadence, for work that takes seconds. The cron interval
   * therefore sets the worst-case *latency* between a run falling due and work
   * starting, not the throughput.
   *
   * `waitForCompletion` matters here more than anywhere else in the app: `@Cron`
   * does not await the previous invocation, so without it a drain lasting
   * longer than the interval would have several copies running inside one pod.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'runner',
    waitForCompletion: true,
  })
  async drain(): Promise<void> {
    let settledRuns = 0;
    let settledPurchases = 0;
    let failed = 0;

    for (let taken = 0; taken < MAX_RUNS_PER_TICK; taken += 1) {
      const run = await this.claimOneRun();
      if (!run) break;

      try {
        const result = await this.settlementService.settle(run);

        await this.prismaMaster.settlementRun.update({
          where: { id: run.id },
          data: {
            status: SettlementRunStatusEnum.DONE,
            finishedAt: new Date(),
          },
        });

        settledRuns += 1;
        settledPurchases += result.claimed;
      } catch (error) {
        failed += 1;

        // Deliberately left `RUNNING`, and deliberately not rethrown.
        //
        // Left RUNNING because that is what the sweeper looks for: it returns
        // the run to PENDING once `claimedAt` is stale, and `attempts` - already
        // incremented by the claim - is what eventually gives up on it. Marking
        // it FAILED here would skip the retries entirely.
        //
        // Not rethrown because one broken merchant must not stop the drain for
        // everyone else due in the same tick.
        await this.recordFailure(run.id, error);

        this.logger.error({
          msg: 'run failed; left RUNNING for the sweeper',
          runId: run.id,
          merchantId: run.merchantId,
          attempts: run.attempts,
          error,
        });
      }
    }

    if (settledRuns + failed === 0) return;

    this.logger.log({
      msg: 'drain complete',
      runs: settledRuns,
      purchases: settledPurchases,
      failed,
    });
  }

  /**
   * Take the single oldest due run that nobody else holds.
   *
   * Raw SQL because it has to be one statement. Selecting a candidate and then
   * updating it from JavaScript reopens the window two pods could both pass
   * through - the lock would be taken after the decision rather than as part of
   * it.
   *
   * `FOR UPDATE SKIP LOCKED` is what makes two pods useful rather than
   * contending: the second skips past the row the first holds and takes a
   * different merchant, instead of queueing behind it. `LIMIT 1` inside the
   * subquery with the `UPDATE` outside means Postgres guarantees exactly one
   * pod wins each row.
   *
   * `attempts` is incremented here, at the moment of claiming, rather than on
   * failure. A pod that dies mid-run never gets to record anything, and that is
   * precisely the case the attempt count has to notice.
   */
  private async claimOneRun(): Promise<ClaimedRun | null> {
    const rows = await this.prismaMaster.$queryRaw<ClaimedRun[]>`
      UPDATE "settlement"."SettlementRun"
      SET "status"    = 'RUNNING',
          "claimedBy" = ${this.settlementConfig.POD_IDENTITY},
          "claimedAt" = now(),
          "attempts"  = "attempts" + 1
      WHERE "id" = (
        SELECT r."id"
        FROM "settlement"."SettlementRun" r
        WHERE r."status" = 'PENDING' AND r."dueAt" <= now()
        ORDER BY r."dueAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id", "merchantId", "paymentMethodName", "dueAt", "attempts"
    `;

    return rows[0] ?? null;
  }

  /**
   * Record why the last attempt failed, without changing the run's status.
   *
   * Survives the sweeper's reset, which clears only the lease columns - so a
   * run that has bounced twice still carries the reason it bounced, which is
   * the first thing anyone reading a `FAILED` run wants.
   *
   * Never allowed to throw: it runs on a path that is already handling an
   * error, and losing the drain over a failed log write would turn one
   * merchant's problem into everybody's.
   */
  private async recordFailure(runId: number, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);

    try {
      await this.prismaMaster.settlementRun.update({
        where: { id: runId },
        data: { failureReason: reason.slice(0, 1000) },
      });
    } catch (writeError) {
      this.logger.error({
        msg: 'could not record a run failure reason',
        runId,
        error: writeError,
      });
    }
  }
}
