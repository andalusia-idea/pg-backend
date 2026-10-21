import {
  SETTLEMENT_RUNNER_USER_ID,
  SettlementModeEnum,
} from '@app/microservice';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@transaction/prisma';
import { PRISMA_MASTER_TRANSACTION_PROVIDER_KEY } from '../database';
import { mostRecentDueAt, type EligibilityWindow } from '../policy';

/** One run to create: a merchant, a resolved method, and the boundary it is for. */
type PendingRun = {
  merchantId: number;
  paymentMethodName: string;
  dueAt: Date;
  createdBy: number;
};

@Injectable()
export class EnqueuerService {
  private readonly logger = new Logger(EnqueuerService.name);

  constructor(
    @Inject(PRISMA_MASTER_TRANSACTION_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
  ) {}

  /**
   * Write down the settlement work that has become due. Does none of it.
   *
   * Separate from the runner because deciding what needs doing and doing it
   * fail differently: if settling throws, the record that it was needed has
   * already been committed and another pod picks it up.
   */
  // Kept on the :00 boundary deliberately: this is the reference the other two
  // jobs offset themselves *from*, so moving it would move them. See RUNNER_CRON.
  @Cron(CronExpression.EVERY_10_MINUTES, {
    name: 'enqueuer',
    waitForCompletion: true,
  })
  async writeToSettlementRun(): Promise<void> {
    const now = new Date();

    const policies = await this.prismaMaster.merchantSettlementPolicy.findMany({
      where: {
        deletedAt: null,
        effectiveFrom: { lte: now }, // already started
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }], // hasn't ended
      },
    });

    const windowsByMethod = await this.inForceWindowsByMethod(now);
    const rows: PendingRun[] = [];

    for (const policy of policies) {
      try {
        rows.push(...this.runsFor(policy, now, windowsByMethod));
      } catch (error) {
        // One misconfigured policy must not stop every other merchant being
        // enqueued. `businessDaysOnly` is the live case: it refuses outright
        // until the holiday calendar exists.
        this.logger.error({
          msg: 'skipping a policy the schedule cannot be derived from',
          policyId: policy.id,
          merchantId: policy.merchantId,
          error,
        });
      }
    }

    if (rows.length === 0) return;

    // One statement, and a duplicate is the *expected* outcome rather than an
    // error: this pod's previous tick and the other pod's tick both compute the
    // same boundary, so both collide on
    // @@unique([merchantId, paymentMethodName, dueAt]).
    const { count } = await this.prismaMaster.settlementRun.createMany({
      data: rows,
      skipDuplicates: true,
    });

    if (count > 0) {
      this.logger.log({ msg: 'runs enqueued', count, considered: rows.length });
    }
  }

  /**
   * The runs one policy is due for, after the fan-out.
   *
   * `FOLLOW_UPSTREAM` on `'*'` expands to one run per method that has a window,
   * because boundaries come from the partner and partners settle each method on
   * their own schedule - QRIS at 15:00, e-wallet at end of day. One run cannot
   * carry two cutoffs, so the claim would have to release one of them early.
   * Every other mode has a merchant-wide boundary and produces a single run.
   */
  private runsFor(
    policy: {
      id: number;
      merchantId: number;
      paymentMethodName: string;
      mode: SettlementModeEnum;
      delayDays: number | null;
      releaseTimes: string[];
      businessDaysOnly: boolean;
      effectiveFrom: Date;
    },
    now: Date,
    windowsByMethod: Map<string, EligibilityWindow[]>,
  ): PendingRun[] {
    const targets =
      policy.mode === SettlementModeEnum.FOLLOW_UPSTREAM &&
      policy.paymentMethodName === '*'
        ? [...windowsByMethod.keys()]
        : [policy.paymentMethodName];

    const rows: PendingRun[] = [];

    for (const paymentMethodName of targets) {
      const windows = windowsByMethod.get(paymentMethodName) ?? [];

      if (
        policy.mode === SettlementModeEnum.FOLLOW_UPSTREAM &&
        windows.length > 1
      ) {
        // Ambiguous: two partners settling the same method on different
        // schedules. Picking one silently is the error this whole design
        // exists to avoid, and SettlementService refuses it too. Skipping is
        // visible through the "money waiting that should have moved" query.
        this.logger.error({
          msg: 'several upstream windows for one method; cannot derive one boundary',
          merchantId: policy.merchantId,
          paymentMethodName,
          windows: windows.length,
        });

        continue;
      }

      const dueAt = mostRecentDueAt(policy, now, windows[0]);

      // No boundary has passed yet - a brand-new policy whose first release is
      // still ahead, or FOLLOW_UPSTREAM on a method nobody has seeded.
      if (!dueAt) continue;

      // Never enqueue a boundary from before the terms came into force: it
      // would claim transactions under a policy that did not yet apply.
      if (dueAt.getTime() < policy.effectiveFrom.getTime()) continue;

      rows.push({
        merchantId: policy.merchantId,
        paymentMethodName,
        dueAt,
        createdBy: SETTLEMENT_RUNNER_USER_ID,
      });
    }

    return rows;
  }

  /**
   * Every in-force upstream window, keyed by payment method.
   *
   * Read once per tick rather than per policy - there are a handful of windows
   * and potentially thousands of policies.
   */
  private async inForceWindowsByMethod(
    now: Date,
  ): Promise<Map<string, EligibilityWindow[]>> {
    const windows = await this.prismaMaster.upstreamSettlementWindow.findMany({
      where: {
        deletedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: {
        paymentMethodName: true,
        settlementOffset: true,
        settlementTime: true,
        timezone: true,
      },
    });

    const byMethod = new Map<string, EligibilityWindow[]>();

    for (const window of windows) {
      const forMethod = byMethod.get(window.paymentMethodName) ?? [];
      forMethod.push(window);
      byMethod.set(window.paymentMethodName, forMethod);
    }

    return byMethod;
  }
}
