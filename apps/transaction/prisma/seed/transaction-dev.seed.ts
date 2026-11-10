import {
  BalanceBucketEnum,
  BalanceDirectionEnum,
  BalanceHolderTypeEnum,
  BalanceMovement,
  BalanceReasonEnum,
  BalanceService,
  BalanceSourceTypeEnum,
  INTERNAL_HOLDER_ID,
} from '@app/balance';
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  SYSTEM_USER_ID,
} from '@app/microservice';
import { PrismaClient } from '@transaction/prisma';
import Decimal from 'decimal.js';
import { findAuthUserIdsByEmail, logSeeded } from './seed.helper';

/**
 * DEVELOPMENT ONLY - never run against production.
 *
 * Balance fixtures: enough state for the nightly verification job to have
 * something real to check, and for the dashboard's balance screens to render
 * something other than zeroes.
 *
 * **Written through `BalanceService.post()`, never with raw inserts.** A fixture
 * built by hand could express a state the real code cannot produce - a snapshot
 * that disagrees with its entries, a transfer that does not net to zero - and
 * then the first bug anyone chases is in the fixture. Going through the service
 * means these rows are only reachable the same way production rows are.
 *
 * Three things constrain what can be written here:
 *
 * 1. **Ids come from another schema.** `holderId` is an `auth.User` id, matching
 *    `config.Merchant.id` / `config.Agent.id`. There is no cross-schema foreign
 *    key, so a wrong id does not error - it produces a balance belonging to
 *    nobody. Resolved by email through `findAuthUserIdsByEmail`, and the whole
 *    seed skips loudly if the auth dev users are missing.
 *
 * 2. **`sourceId`s are synthetic.** They sit in a 9000+ range and point at
 *    purchases and disbursements that do not exist - there is no foreign key on
 *    `sourceId`, deliberately, because a balance entry has to be able to outlive
 *    whatever caused it. Transaction fixtures are a separate job; when they
 *    land, these should point at the real rows instead.
 *
 * 3. **Idempotency comes from fixed `sourceId`s.** The unique constraint on
 *    `(holder, bucket, reason, sourceType, sourceId)` makes a re-run a no-op,
 *    but only because nothing here is generated. Never introduce a random or
 *    time-based id.
 *
 * Each movement is posted in its own transaction, matching how it happens for
 * real - a capture is a webhook, a settlement is a batch, a reservation is a
 * payout request. Doing them in one transaction would test a path production
 * never takes.
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
 * Upstream settlement windows - what each partner has published about when they
 * release our money, transcribed from
 * docs/accounting/upstream-settlement-schedules.md.
 *
 * **These moved here from the engine tier on 2026-11-09, and the reason is the
 * admin API.** The engine tier used to be the only way a row could exist, so it
 * had to carry them however little it liked doing so: `FOLLOW_UPSTREAM`
 * eligibility cannot answer anything without a window, which made them
 * vocabulary the system booted with. `POST /super-admin/settlement-window` (D26)
 * replaced that, and D27 taught the general shape of the rule the hard way - a
 * table kept out of the engine tier needs *some* production path, or production
 * has none at all. There is one now, so these rows become what they always
 * looked like: a convenience so a development database has plausible schedules
 * without anyone hand-posting four of them, and a production database gets its
 * own from the partner notice through the API, like base fees and providers.
 *
 * Seeded before the auth-user lookup below, deliberately: unlike every balance
 * fixture here, a window belongs to nobody and needs no `auth.User` to exist.
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

  /*
   * Teleanjar runs two batches on one rail, which is the case `label` exists in
   * the unique key for.
   *
   * **Restated as half-open intervals**, which is what the reference doc asks
   * the partner to confirm. As they word it the batches are `18:00 - 12:00` and
   * `12:01 - 18:00`, and that wording has two faults: 18:00 appears in both, so
   * a transaction at exactly 18:00:00 belongs to neither batch or to both, and
   * nothing at all owns 12:00:01 - 12:00:59. Under `[start, end)` both faults
   * disappear, and the two windows then tile the day exactly - 18 hours plus 6,
   * batch 2 ending where the next batch 1 begins. That the arithmetic closes is
   * the evidence the restatement is right; it is still worth getting in
   * writing.
   *
   * **The payment method is the one field the reference doc does not give.**
   * It records the batches with no product named. `TRANSFERBANK` here because
   * the only other mention of Teleanjar in the tree is
   * `libs/upstream/src/upstream.constant.ts`, which groups it with MotionPay
   * and Jatelindo as a bank payout rail. Correct it in place while nothing
   * reads these - once something does, a change of product is a new row.
   */
  {
    providerName: ProviderNameEnum.TELEANJAR,
    paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
    label: 'BATCH_1',
    windowStart: '18:00',
    // The window opens the evening before it closes, which is the only thing
    // this column is for.
    windowStartDayOffset: -1,
    windowEnd: '12:00',
    settlementOffset: 0,
    settlementTime: '13:00',
    explain: 'batch 1, 18:00 (D-1) to 12:00, same day 13:00',
  },
  {
    providerName: ProviderNameEnum.TELEANJAR,
    paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
    label: 'BATCH_2',
    windowStart: '12:00',
    windowStartDayOffset: 0,
    windowEnd: '18:00',
    settlementOffset: 0,
    settlementTime: '19:00',
    explain: 'batch 2, 12:00 to 18:00, same day 19:00',
  },
];

/** Whose money each fixture belongs to, and what happened to it. */
type BalanceFixture = {
  label: string;
  merchantEmail: string;
  /** null when the merchant has no agent taking a share. */
  agentEmail: string | null;
  purchaseId: number;
  gross: string;
  /** MotionPay keeps this. It never reaches us, so it gets no balance leg. */
  providerFee: string;
  internalFee: string;
  agentFee: string;
  merchantNet: string;
  /** Has the settlement batch promoted it from PENDING to AVAILABLE yet? */
  settled: boolean;
  /** An in-flight payout holding part of AVAILABLE in RESERVED. */
  reserved: { disbursementId: number; amount: string } | null;
};

/**
 * Four merchants, four states. Between them they cover every bucket, both
 * holder types that can earn, and the no-rows-at-all case.
 *
 * Every row's four fees plus the merchant's net must equal its gross - the same
 * invariant the real fee calculator has to satisfy. `assertSplitsBalance` checks
 * it before anything is written, because a fixture that does not add up teaches
 * the wrong thing about what correct data looks like.
 */
const FIXTURES: BalanceFixture[] = [
  {
    label: 'captured, not yet settled',
    merchantEmail: 'merchant1@example.com',
    agentEmail: 'agent1@example.com',
    purchaseId: 9001,
    gross: '100000.00',
    providerFee: '800.00',
    internalFee: '1000.00',
    agentFee: '200.00',
    merchantNet: '98000.00',
    settled: false,
    reserved: null,
  },
  {
    label: 'settled, fully spendable',
    merchantEmail: 'merchant2@example.com',
    agentEmail: 'agent2@example.com',
    purchaseId: 9002,
    gross: '250000.00',
    providerFee: '2000.00',
    internalFee: '2500.00',
    agentFee: '500.00',
    merchantNet: '245000.00',
    settled: true,
    reserved: null,
  },
  {
    label: 'settled, payout in flight',
    merchantEmail: 'merchant3@example.com',
    agentEmail: 'agent3@example.com',
    purchaseId: 9003,
    gross: '500000.00',
    providerFee: '4000.00',
    internalFee: '5000.00',
    agentFee: '1000.00',
    merchantNet: '490000.00',
    settled: true,
    reserved: { disbursementId: 9101, amount: '120000.00' },
  },
];

/**
 * merchant4 is deliberately absent from FIXTURES.
 *
 * A holder with no balance rows at all is a real state - every merchant starts
 * there - and the dashboard has to render it as zero rather than as missing.
 * Leaving one merchant untouched is what keeps that path exercised.
 */
const NO_BALANCE_MERCHANT = 'merchant4@example.com';

/** The audit identity every seeded row is attributed to. */
const SEED_PRINCIPAL_EMAIL = 'system01@pg.id';

export async function transactionDevSeed(prisma: PrismaClient): Promise<void> {
  assertSplitsBalance();

  // First, and outside the auth-user guard below: a settlement window belongs
  // to nobody, so it has nothing to resolve and no reason to be skipped when
  // the auth dev users are missing.
  await seedUpstreamWindows(prisma);

  const emails = [
    SEED_PRINCIPAL_EMAIL,
    NO_BALANCE_MERCHANT,
    ...FIXTURES.map((fixture) => fixture.merchantEmail),
    ...FIXTURES.map((fixture) => fixture.agentEmail).filter(
      (email): email is string => email !== null,
    ),
  ];

  const userIds = await findAuthUserIdsByEmail(prisma, emails);

  const missing = emails.filter((email) => !userIds.has(email));
  if (missing.length > 0) {
    // Loud rather than silent: hardcoding ids to work around this is exactly
    // how a fixture ends up belonging to nobody.
    console.log(
      `  skipped - auth dev users not found: ${missing.join(', ')}.\n` +
        '  Run `npm run prisma:seed:auth:dev` first.',
    );
    return;
  }

  const createdBy = userIds.get(SEED_PRINCIPAL_EMAIL)!;
  const balanceService = new BalanceService();

  // Idempotency here is "skip what is already present", not "upsert". Entries
  // are append-only, so there is nothing to upsert into - and `post()` is
  // deliberately strict: a second attempt at the same movement hits the unique
  // constraint and throws, which is exactly what protects a real webhook from
  // double-crediting. A seed therefore has to ask first rather than retry.
  const alreadySeeded = await findSeededPurchaseIds(prisma);

  let movements = 0;
  let skipped = 0;

  for (const fixture of FIXTURES) {
    if (alreadySeeded.has(fixture.purchaseId)) {
      logSeeded(fixture.merchantEmail, 'already present');
      skipped += 1;
      continue;
    }

    const merchantId = userIds.get(fixture.merchantEmail)!;
    const agentId = fixture.agentEmail
      ? userIds.get(fixture.agentEmail)!
      : null;

    for (const movement of buildMovements(
      fixture,
      merchantId,
      agentId,
      createdBy,
    )) {
      await prisma.$transaction(async (tx) => {
        await balanceService.post(tx, movement);
      });
      movements += 1;
    }

    if (fixture.reserved) {
      const { disbursementId, amount } = fixture.reserved;

      const result = await prisma.$transaction(async (tx) =>
        balanceService.reserve(tx, {
          holderType: BalanceHolderTypeEnum.MERCHANT,
          holderId: merchantId,
          amount: new Decimal(amount),
          sourceType: BalanceSourceTypeEnum.DISBURSEMENT,
          sourceId: disbursementId,
          createdBy,
        }),
      );

      // A fixture that cannot reserve its own amount is a broken fixture, not a
      // runtime condition to tolerate.
      if (!result.ok) {
        throw new Error(
          `dev seed: ${fixture.merchantEmail} could not reserve ${amount} - ` +
            'the fixture reserves more than it settles.',
        );
      }
      movements += 1;
    }

    logSeeded(fixture.merchantEmail, fixture.label);
  }

  if (skipped === FIXTURES.length) {
    logSeeded('nothing to do', 'all fixtures already seeded');
    return;
  }

  logSeeded(NO_BALANCE_MERCHANT, 'no balance rows (intentional)');
  logSeeded('movements posted', movements);
}

/**
 * Upserts the published schedules on the unique key, `update: {}` - the same
 * contract the other seeders use. Re-running fills in what is missing and never
 * overwrites a schedule an admin has since corrected through
 * `POST /super-admin/settlement-window`, which is the whole point of the empty
 * update now that the API is where real rows come from.
 */
async function seedUpstreamWindows(prisma: PrismaClient): Promise<void> {
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

/**
 * Which fixtures have already been written.
 *
 * Keyed on `PAYIN_CAPTURED` because it is the first movement of every fixture,
 * so its presence is the cheapest "this one is done" signal.
 *
 * It is a coarse check: a crash *between* a fixture's capture and its settle
 * would leave that fixture half-written, and a re-run would then skip it rather
 * than finish it. Acceptable for dev data, where the recovery is
 * `prisma migrate reset`. Do not copy this shape into anything that has to
 * resume real work - that needs per-movement state, which is what
 * `SettlementRun` exists for.
 */
async function findSeededPurchaseIds(
  prisma: PrismaClient,
): Promise<Set<number>> {
  const rows = await prisma.balanceEntry.findMany({
    where: {
      reason: BalanceReasonEnum.PAYIN_CAPTURED,
      sourceType: BalanceSourceTypeEnum.PURCHASE,
      sourceId: { in: FIXTURES.map((fixture) => fixture.purchaseId) },
    },
    select: { sourceId: true },
  });

  return new Set(rows.map((row) => row.sourceId));
}

/**
 * Capture, then optionally settle. The reservation is handled by the caller
 * because it goes through `reserve()` rather than `post()` - the balance check
 * and the row lock have to be one statement.
 */
function buildMovements(
  fixture: BalanceFixture,
  merchantId: number,
  agentId: number | null,
  createdBy: number,
): BalanceMovement[] {
  const shares: {
    holderType: BalanceHolderTypeEnum;
    holderId: number;
    amount: Decimal;
  }[] = [
    {
      holderType: BalanceHolderTypeEnum.MERCHANT,
      holderId: merchantId,
      amount: new Decimal(fixture.merchantNet),
    },
    {
      holderType: BalanceHolderTypeEnum.INTERNAL,
      holderId: INTERNAL_HOLDER_ID,
      amount: new Decimal(fixture.internalFee),
    },
  ];

  if (agentId !== null) {
    shares.push({
      holderType: BalanceHolderTypeEnum.AGENT,
      holderId: agentId,
      amount: new Decimal(fixture.agentFee),
    });
  }

  // The provider's cut is absent on purpose - it is deducted upstream and never
  // lands in a balance we track.
  const captured: BalanceMovement = {
    reason: BalanceReasonEnum.PAYIN_CAPTURED,
    sourceType: BalanceSourceTypeEnum.PURCHASE,
    sourceId: fixture.purchaseId,
    createdBy,
    legs: shares.map((share) => ({
      ...share,
      bucket: BalanceBucketEnum.PENDING,
      direction: BalanceDirectionEnum.CREDIT,
    })),
  };

  if (!fixture.settled) return [captured];

  // Two legs per holder: out of PENDING, into AVAILABLE. They net to zero per
  // holder, which is what BalanceService asserts for a transfer reason.
  const settled: BalanceMovement = {
    reason: BalanceReasonEnum.MERCHANT_SETTLED,
    sourceType: BalanceSourceTypeEnum.PURCHASE,
    sourceId: fixture.purchaseId,
    createdBy,
    legs: shares.flatMap((share) => [
      {
        ...share,
        bucket: BalanceBucketEnum.PENDING,
        direction: BalanceDirectionEnum.DEBIT,
      },
      {
        ...share,
        bucket: BalanceBucketEnum.AVAILABLE,
        direction: BalanceDirectionEnum.CREDIT,
      },
    ]),
  };

  return [captured, settled];
}

/**
 * Fail before writing anything if a fixture's fee split does not reconstruct its
 * gross, or if it reserves more than it settles.
 *
 * Both are arithmetic a reader will assume holds. Catching them here costs
 * nothing; catching them later means wondering whether the ledger or the fixture
 * is wrong.
 */
function assertSplitsBalance(): void {
  for (const fixture of FIXTURES) {
    const parts = new Decimal(fixture.providerFee)
      .plus(fixture.internalFee)
      .plus(fixture.agentFee)
      .plus(fixture.merchantNet);

    if (!parts.equals(fixture.gross)) {
      throw new Error(
        `dev seed: ${fixture.merchantEmail} fee split sums to ${parts.toFixed(2)}, not its gross ${fixture.gross}.`,
      );
    }

    if (fixture.reserved) {
      if (!fixture.settled) {
        throw new Error(
          `dev seed: ${fixture.merchantEmail} reserves a payout but is never settled, so it has no AVAILABLE balance to reserve from.`,
        );
      }

      if (
        new Decimal(fixture.reserved.amount).greaterThan(fixture.merchantNet)
      ) {
        throw new Error(
          `dev seed: ${fixture.merchantEmail} reserves ${fixture.reserved.amount}, more than the ${fixture.merchantNet} it settles.`,
        );
      }
    }
  }
}
