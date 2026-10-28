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
