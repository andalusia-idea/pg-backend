/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  SYSTEM_USER_ID,
} from '@app/microservice';
import { PrismaClient } from '@transaction/prisma';
import { logSeeded } from './seed.helper';

/**
 * MANDATORY - production data.
 *
 * Almost everything in this schema is a record of something that happened:
 * transactions created by merchants through the Open API, fee details computed
 * when each one is priced, webhook logs, audits, and the append-only balance
 * entries written as a side effect of settlement. None of that is seeded, and a
 * production `transaction` schema is correct precisely when those tables are
 * empty.
 *
 * The `settlement` schema that rides along in these migrations is the exception.
 * `UpstreamSettlementWindow` is not recorded activity - it is a transcription of
 * what each partner has told us about when they release our money, and
 * `FOLLOW_UPSTREAM` eligibility cannot answer anything without it. So it is
 * vocabulary the system boots with, like auth's roles or config's payment
 * methods, and it belongs here.
 *
 * `MerchantSettlementPolicy` is **not** seeded: a policy is per merchant, and
 * `registerMerchant` creates the default row inside the same transaction as the
 * merchant itself.
 *
 * `BusinessDayCalendar` is **not** seeded either. The holiday rules only matter
 * once Pakailink is live, no partner has told us their policy yet, and
 * eligibility refuses outright while `businessDaysOnly` is set rather than
 * guessing - see `apps/settlement/src/policy/policy.eligibility.ts`.
 */

/**
 * The instant these schedules are treated as having come into force.
 *
 * A fixed constant, never `new Date()`. `effectiveFrom` is part of the unique
 * key, so a moving value would insert a fresh row on every seed run instead of
 * matching the existing one - the seed would stop being idempotent, and
 * `FOLLOW_UPSTREAM` would then find several windows where it expects one.
 *
 * Backdated so it is already in force for any transaction this database has
 * ever seen. A real schedule change gets a *new* row with a later
 * `effectiveFrom` and an `effectiveTo` on this one, which is what the effective
 * dating is for.
 */
const SCHEDULES_IN_FORCE_FROM = new Date('2026-01-01T00:00:00+07:00');

/**
 * What each partner has published, transcribed from
 * docs/accounting/upstream-settlement-schedules.md. Add partners as they go
 * live; MotionPay is the only one integrated today.
 *
 * **`windowStart` / `windowEnd` are not consumed yet.** Eligibility derives the
 * release moment from the payment's own calendar day plus `settlementOffset`,
 * and choosing *which* window a payment falls into is deferred to Step 10 -
 * deliberately, because the boundary rules are still open questions with the
 * partners. The columns record what was published so that work has something to
 * start from.
 *
 * A window whose end equals its start spans the full day. The alternative,
 * writing `23:59` as MotionPay words it, would silently drop the final minute
 * once something reads these under the half-open `[start, end)` convention the
 * column documents.
 */
const UPSTREAM_WINDOWS: {
  providerName: ProviderNameEnum;
  paymentMethodName: PaymentMethodNameEnum;
  label: string;
  windowStart: string;
  windowStartDayOffset: number;
  windowEnd: string;
  settlementOffset: number;
  settlementTime: string | null;
  explain: string;
}[] = [
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.QRIS,
    label: 'DAILY',
    windowStart: '00:00',
    windowStartDayOffset: 0,
    windowEnd: '00:00',
    settlementOffset: 1,
    settlementTime: '15:00',
    explain: 'QRIS, next day 15:00',
  },
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.DIRECTEWALLET,
    label: 'DAILY',
    windowStart: '00:00',
    windowStartDayOffset: 0,
    windowEnd: '00:00',
    settlementOffset: 3,
    // No published time. Eligibility treats null as end of day rather than
    // start, so we never release before the upstream plausibly has.
    settlementTime: null,
    explain: 'E-Wallet, H+3, no published time (window assumed same day)',
  },
];

export async function transactionEngineSeed(
  prisma: PrismaClient,
): Promise<void> {
  // Upsert on the unique key, `update: {}` - the same contract the other
  // seeders use. Re-running fills in what is missing and never overwrites a
  // schedule an admin has since corrected by hand.
  await prisma.$transaction(
    UPSTREAM_WINDOWS.map((window) =>
      prisma.upstreamSettlementWindow.upsert({
        where: {
          providerName_paymentMethodName_label_effectiveFrom: {
            providerName: window.providerName,
            paymentMethodName: window.paymentMethodName,
            label: window.label,
            effectiveFrom: SCHEDULES_IN_FORCE_FROM,
          },
        },
        // Listed field by field rather than spread, so `explain` - which is
        // documentation for the log line, not a column - cannot leak in.
        create: {
          providerName: window.providerName,
          paymentMethodName: window.paymentMethodName,
          label: window.label,
          windowStart: window.windowStart,
          windowStartDayOffset: window.windowStartDayOffset,
          windowEnd: window.windowEnd,
          settlementOffset: window.settlementOffset,
          settlementTime: window.settlementTime,
          effectiveFrom: SCHEDULES_IN_FORCE_FROM,
          createdBy: SYSTEM_USER_ID,
        },
        update: {},
        select: { id: true },
      }),
    ),
  );

  for (const window of UPSTREAM_WINDOWS) {
    logSeeded(
      `${window.providerName} ${window.paymentMethodName}`,
      window.explain,
    );
  }
}
