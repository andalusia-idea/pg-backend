import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaClient, SettlementRunStatusEnum } from '@transaction/prisma';
import { PRISMA_MASTER_TRANSACTION_PROVIDER_KEY } from '../database';
import { CronHeartbeat } from './cron-heartbeat';

/**
 * How long a run may sit in `RUNNING` before it is presumed abandoned.
 *
 * The sweeper's cron must fire more often than this, or a crashed run waits
 * longer than it needs to - every 5 minutes gives three chances per window.
 *
 * Long enough that a slow-but-alive run is not stolen from underneath itself. A
 * run settles up to 500 purchases per batch and loops, so fifteen minutes is
 * generous for a merchant with a normal backlog and still short enough that a
 * pod killed mid-run does not strand a day's money.
 */
const STALE_AFTER_MINUTES = 15;

/**
 * How many times a run may be attempted before it is given up on.
 *
 * Without this a merchant whose settlement genuinely cannot complete - a
 * malformed policy, a purchase the claim keeps choking on - cycles between
 * RUNNING and PENDING forever, and every tick it is picked up is a tick some
 * other merchant was not.
 */
const MAX_ATTEMPTS = 3;

/** Minutes between ticks. Must match SWEEPER_CRON. */
const SWEEPER_INTERVAL_MINUTES = 5;

/**
 * 45 seconds past every fifth minute.
 *
 * Shorter than STALE_AFTER_MINUTES so a crashed run gets three chances per
 * staleness window rather than waiting out a whole one.
 *
 * Offset off the minute boundary for the same reason the runner is - see
 * RUNNER_CRON - though it matters less here: the sweeper only touches runs
 * whose `claimedAt` is already fifteen minutes old, so it cannot race a claim
 * the runner just made. The offset is for tidiness and to keep three jobs from
 * hitting the database on the same instant.
 */
const SWEEPER_CRON = '45 */5 * * * *';

@Injectable()
export class SweeperService {
  private readonly logger = new Logger(SweeperService.name);
  private readonly heartbeat = new CronHeartbeat(SWEEPER_INTERVAL_MINUTES);

  constructor(
    @Inject(PRISMA_MASTER_TRANSACTION_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
  ) {}

  /**
   * Put crashed runs back on the list, and give up on the hopeless ones.
   *
   * **This is only safe because the claim is idempotent.** The sweeper makes no
   * attempt to work out what a dead pod finished, and does not need to:
   * whatever it settled is no longer `batchSettlementId IS NULL`, so a re-run
   * claims exactly the remainder. That is the whole payoff of claiming instead
   * of selecting by time window.
   *
   * Decides on `claimedAt` age alone and never reads `claimedBy`. That column
   * holds a pod name - diagnostic, and different on every deploy - so filtering
   * on it would break the first time a pod was replaced.
   */
  @Cron(SWEEPER_CRON, { name: 'sweeper', waitForCompletion: true })
  async sweep(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_AFTER_MINUTES * 60 * 1000);

    // Give up *before* retrying, deliberately. Reset first and a run that has
    // already burned its attempts goes back to PENDING for one more cycle,
    // which is the loop MAX_ATTEMPTS exists to stop.
    const abandoned = await this.prismaMaster.settlementRun.updateMany({
      where: {
        status: SettlementRunStatusEnum.RUNNING,
        claimedAt: { lt: staleBefore },
        attempts: { gte: MAX_ATTEMPTS },
      },
      data: {
        status: SettlementRunStatusEnum.FAILED,
        finishedAt: new Date(),
        failureReason:
          `Abandoned after ${MAX_ATTEMPTS} attempts: still RUNNING more than ` +
          `${STALE_AFTER_MINUTES} minutes after being claimed each time. ` +
          'Needs a person - the claim is idempotent, so a manual reset to ' +
          'PENDING will settle only what is left.',
      },
    });

    // `attempts` is deliberately not cleared: it is the only thing standing
    // between a broken merchant and an infinite retry. `claimedBy`/`claimedAt`
    // are cleared because they describe a process that is gone.
    const revived = await this.prismaMaster.settlementRun.updateMany({
      where: {
        status: SettlementRunStatusEnum.RUNNING,
        claimedAt: { lt: staleBefore },
        attempts: { lt: MAX_ATTEMPTS },
      },
      data: {
        status: SettlementRunStatusEnum.PENDING,
        claimedBy: null,
        claimedAt: null,
      },
    });

    if (revived.count + abandoned.count === 0) {
      // Finding nothing is the healthy case here, and the one that most needs
      // proof of life: a sweeper that silently stopped would let crashed runs
      // sit forever, and nothing else in the system would notice.
      this.logger.debug({ msg: 'no stale runs' });

      const idleTicks = this.heartbeat.wasIdle();
      if (idleTicks !== null) {
        this.logger.log({ msg: 'sweeper alive, no stale runs', idleTicks });
      }

      return;
    }

    this.heartbeat.didWork();

    if (revived.count > 0) {
      this.logger.warn({
        msg: 'returned stale runs to PENDING',
        count: revived.count,
        staleAfterMinutes: STALE_AFTER_MINUTES,
      });
    }

    if (abandoned.count > 0) {
      this.logger.error({
        msg: 'gave up on runs after too many attempts',
        count: abandoned.count,
        maxAttempts: MAX_ATTEMPTS,
      });
    }
  }
}
