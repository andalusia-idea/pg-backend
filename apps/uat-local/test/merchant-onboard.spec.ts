import {
  callDashboard,
  login,
  loginAgentInternal,
  loginSuperAdmin,
  MERCHANT_1,
  MERCHANT_2,
  MERCHANT_3,
  MERCHANT_4,
  MERCHANT_PASSWORD,
  MERCHANTS,
} from '../src/helper';
import { CreateMerchantDto } from 'apps/dashboard/src/modules/user';
import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionTypeEnum,
} from '@app/microservice';
/*
 * Imported from the leaf files, never the barrels.
 *
 * `apps/dashboard/src/modules/config-merchant` re-exports its module, which
 * pulls in the controller, the service and from there `@dashboard/prisma` - a
 * client generated for ESM with `.ts` import specifiers that nothing in this
 * repo can load under ts-jest. The DTOs themselves are types here and
 * TypeScript erases them, so only `ActionEnum` is a real runtime import, and
 * `config-merchant.constant` has no imports of its own.
 */
import { UpsertBaseFeeDto } from 'apps/dashboard/src/super-admin/dto/base-fee.dto';
import { BaseFeeDto } from 'apps/dashboard/src/modules/config-fee/dto/base-fee.dto';
import { ActionEnum } from 'apps/dashboard/src/modules/config-merchant/config-merchant.constant';
import { MerchantConfigDto } from 'apps/dashboard/src/modules/config-merchant/dto/merchant-config.dto';
import {
  UpsertMerchantAgentShareholderDto,
  UpsertMerchantFeeDto,
} from 'apps/dashboard/src/modules/config-merchant/dto/upsert-merchant-fee.dto';

const registerMerchant = async (
  token: string,
  createMerchantDto: CreateMerchantDto,
) => {
  const res = await callDashboard<null>({
    method: 'POST',
    url: '/api/v1/user/admin/register-merchant',
    data: createMerchantDto,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return res;
};

/**
 * `BaseFeeDto.code`, rebuilt from the three fields it is derived from. The
 * upsert is keyed on the triple and the response carries the code, so this is
 * the only thing that joins what we send to the ids we get back.
 */
const feeCode = (fee: {
  providerName: string;
  paymentMethodName: string;
  transactionType: string;
}) => `${fee.providerName}_${fee.paymentMethodName}_${fee.transactionType}`;

const MOTIONPAY_QRIS_IN = feeCode({
  providerName: ProviderNameEnum.MOTIONPAY,
  paymentMethodName: PaymentMethodNameEnum.QRIS,
  transactionType: TransactionTypeEnum.PURCHASE,
});
const MOTIONPAY_BANK_OUT = feeCode({
  providerName: ProviderNameEnum.MOTIONPAY,
  paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
  transactionType: TransactionTypeEnum.DISBURSEMENT,
});
const JATELINDO_BANK_OUT = feeCode({
  providerName: ProviderNameEnum.JATELINDO,
  paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
  transactionType: TransactionTypeEnum.DISBURSEMENT,
});

/**
 * The rails this harness drives, including the one the dev seed does not have.
 *
 * `DEV_BASE_FEES` in configDevSeed is MOTIONPAY for every rail plus one
 * INTERNAL row and **no JATELINDO row at all**, so a bank payout seeded that
 * way routes to MotionPay and the Jatelindo client is never reached. That gap
 * is what build-order Step 8 calls "the config gap first", and this is the
 * endpoint that closes it.
 *
 * Harness numbers, not commercial terms. The shapes mirror configDevSeed's
 * invented MOTIONPAY rates so a split computed here looks like one computed
 * against a seeded database; real provider rates come from a signed agreement
 * and are entered through this same endpoint by hand - see
 * docs/engine/dashboard-migration.md §8.
 */
const BASE_FEES: UpsertBaseFeeDto[] = [
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.QRIS,
    transactionType: TransactionTypeEnum.PURCHASE,
    isActive: true,
    feeProviderFixed: '0',
    feeProviderPercentage: '0.8',
  },
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
    transactionType: TransactionTypeEnum.DISBURSEMENT,
    isActive: true,
    feeProviderFixed: '1200',
    feeProviderPercentage: '0',
  },
  {
    providerName: ProviderNameEnum.JATELINDO,
    paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
    transactionType: TransactionTypeEnum.DISBURSEMENT,
    isActive: true,
    feeProviderFixed: '1200',
    feeProviderPercentage: '0',
  },
];

/**
 * Which rails each merchant may transact on, and who takes a cut.
 *
 * **Routing is this row, not a provider setting.**
 * `profile-provider.service.ts` resolves the provider with
 * `merchantFee.findFirstOrThrow` filtered on (paymentMethodName,
 * transactionType) and deliberately *not* on provider - with no `orderBy`. Two
 * rows for one pairing therefore make the chosen provider depend on Postgres
 * row order, which is why Jatelindo goes on merchant3 **alone** rather than as
 * a second payout row on merchant1. The read-back below asserts that
 * one-row-per-pairing property, because it is the thing that silently breaks.
 *
 * merchant4 is left unconfigured on purpose. It is the only way to exercise the
 * 403 that `resolveProvider` documents as an onboarding gap on our side rather
 * than a bad request on the merchant's.
 */
const FEE_PLAN: {
  email: string;
  codes: string[];
  /** Whether an agent takes a share of the internal fee. */
  agentCut: boolean;
}[] = [
  {
    email: MERCHANT_1,
    codes: [MOTIONPAY_QRIS_IN, MOTIONPAY_BANK_OUT],
    agentCut: false,
  },
  {
    email: MERCHANT_2,
    codes: [MOTIONPAY_QRIS_IN, MOTIONPAY_BANK_OUT],
    agentCut: true,
  },
  {
    email: MERCHANT_3,
    codes: [MOTIONPAY_QRIS_IN, JATELINDO_BANK_OUT],
    agentCut: false,
  },
  { email: MERCHANT_4, codes: [], agentCut: false },
];

/** Fixed-scale strings come back from the API, so compare as numbers. */
const isZero = (amount: string) => Number(amount) === 0;

/**
 * Our margin on top of the provider's, following configDevSeed's rule: charge
 * where the provider charges and nothing where it does not, so a rail that
 * costs us a flat fee is marked up with a flat fee and a percentage rail with a
 * percentage.
 */
const merchantFeeFor = (
  base: BaseFeeDto,
  agentCut: boolean,
): UpsertMerchantFeeDto => ({
  action: ActionEnum.U,
  baseFeeId: base.id,
  feeInternalFixed: isZero(base.feeProviderFixed) ? '0' : '600',
  feeInternalPercentage: isZero(base.feeProviderPercentage) ? '0' : '0.4',
  feeAgentFixed: !agentCut || isZero(base.feeProviderFixed) ? '0' : '100',
  feeAgentPercentage:
    !agentCut || isZero(base.feeProviderPercentage) ? '0' : '0.2',
});

/// merchant onboard by AgentInternal
describe('merchant onboard', () => {
  let agentInternal: AuthDto;
  let superAdmin: AuthDto;

  /** `auth.User.id` per merchant - see the note in the ids test. */
  const merchantIdByEmail = new Map<string, number>();
  /** `BaseFeeDto.code` -> the row, so a plan entry can name a rail not an id. */
  const baseFeeByCode = new Map<string, BaseFeeDto>();

  const bearer = (auth: AuthDto) => ({
    Authorization: `Bearer ${auth.token}`,
  });

  beforeAll(async () => {
    agentInternal = await loginAgentInternal();
    superAdmin = await loginSuperAdmin();
    expect(agentInternal.token).toBeTruthy();
    expect(agentInternal.authInfo.userId).toBeGreaterThan(0);
    expect(superAdmin.token).toBeTruthy();
    expect(superAdmin.authInfo.userId).toBeGreaterThan(0);
  });

  /**
   * Not idempotent, unlike everything after it: a second run against the same
   * database fails on the duplicate email. The fee steps below are all upserts,
   * so they still do the right thing on a database that already holds these
   * merchants.
   */
  it('register', async () => {
    const token = agentInternal.token;
    for (const m of MERCHANTS) {
      const res = await registerMerchant(token, m);
      expect(res.statusCode).toEqual(201);
      expect(res.status).toBe('CREATED');
    }
  });

  it('base fee catalogue', async () => {
    const upsert = await callDashboard<null>({
      method: 'POST',
      url: '/api/v1/super-admin/base-fee',
      data: BASE_FEES,
      headers: bearer(superAdmin),
    });
    expect(upsert.statusCode).toEqual(201);

    // Read back rather than trusting the write: the upsert answers 201 with no
    // body, and the ids it assigned are what every merchant fee row needs.
    const read = await callDashboard<BaseFeeDto[]>({
      method: 'GET',
      url: '/api/v1/super-admin/base-fee',
      headers: bearer(superAdmin),
    });

    for (const row of read.data!) baseFeeByCode.set(row.code, row);

    for (const code of [
      MOTIONPAY_QRIS_IN,
      MOTIONPAY_BANK_OUT,
      JATELINDO_BANK_OUT,
    ]) {
      const row = baseFeeByCode.get(code);
      expect(row).toBeDefined();
      expect(row!.id).toBeGreaterThan(0);
    }

    // `isActive` is deliberately not asserted: it is absent from `BaseFeeDto`,
    // so this response cannot distinguish an active row from an inactive or
    // soft-deleted one even though the endpoint returns all three. What makes
    // these rows routable is the `isActive: true` in BASE_FEES above - the
    // routing lookup filters `baseFee.isActive`, and the upsert is what sets
    // it. See the note at the end of this file.
  });

  /**
   * `register-merchant` answers 201 with a null body, so the only way to learn
   * a merchant's id is to sign in as it.
   *
   * **`userId`, not `profileId`.** `config.Merchant` reuses the auth user id as
   * its own primary key, and `profile-provider.service.ts` matches
   * `MerchantFee.merchantId` against the *auth* user id at transaction time.
   * The two are equal today; the assertion is here so that if they ever stop
   * being equal, this fails rather than the fee rows quietly landing against an
   * id nothing routes by.
   */
  it('merchant ids', async () => {
    for (const plan of FEE_PLAN) {
      const auth = await login(plan.email, MERCHANT_PASSWORD);
      expect(auth.authInfo.userId).toBeGreaterThan(0);
      expect(auth.authInfo.profileId).toEqual(auth.authInfo.userId);
      merchantIdByEmail.set(plan.email, auth.authInfo.userId);
    }

    expect(merchantIdByEmail.size).toEqual(FEE_PLAN.length);
    expect(new Set(merchantIdByEmail.values()).size).toEqual(FEE_PLAN.length);
  });

  it('fee config', async () => {
    for (const plan of FEE_PLAN) {
      if (plan.codes.length === 0) continue;

      const merchantId = merchantIdByEmail.get(plan.email)!;
      const body = plan.codes.map((code) =>
        merchantFeeFor(baseFeeByCode.get(code)!, plan.agentCut),
      );

      const res = await callDashboard<null>({
        method: 'POST',
        url: `/api/v1/merchant/${merchantId}/provider`,
        data: body,
        headers: bearer(agentInternal),
      });

      expect(res.statusCode).toEqual(201);
      expect(res.status).toBe('CREATED');
    }
  });

  /**
   * Who receives the agent share that `agentCut` creates.
   *
   * Without this merchant2's `feeAgentFixed` / `feeAgentPercentage` would be
   * deducted with nowhere to go - the fee says an agent is owed and no row says
   * which one. `agentinternal` takes the whole 100% because it is the principal
   * that registered these merchants, which is the same shape configDevSeed uses
   * for its own agent-internal merchant.
   *
   * The batch must total **exactly** 100: `assertShareholderPercentagesTotal`
   * sums the non-delete entries of the request, not the stored set, so a
   * partial update that leaves the table at 100 is still a 400.
   *
   * `profileId`, not `userId`: `AgentShareholder.agentId` is a foreign key to
   * `config.Agent.id`, which is what the AGENT branch of
   * `findProfileIdByUserIdAndRole` returns. The two are equal because
   * `config.Agent` reuses the auth user id, and the assertion says so.
   */
  it('agent shareholder', async () => {
    expect(agentInternal.authInfo.profileId).toEqual(
      agentInternal.authInfo.userId,
    );

    const body: UpsertMerchantAgentShareholderDto[] = [
      {
        action: ActionEnum.U,
        agentId: agentInternal.authInfo.profileId,
        percentagePerAgent: '100',
      },
    ];

    for (const plan of FEE_PLAN) {
      if (!plan.agentCut) continue;

      const res = await callDashboard<null>({
        method: 'POST',
        url: `/api/v1/merchant/${merchantIdByEmail.get(plan.email)!}/agent-shareholder`,
        data: body,
        headers: bearer(agentInternal),
      });

      expect(res.statusCode).toEqual(201);
      expect(res.status).toBe('CREATED');
    }
  });

  it('fee config reads back', async () => {
    for (const plan of FEE_PLAN) {
      const merchantId = merchantIdByEmail.get(plan.email)!;

      const res = await callDashboard<MerchantConfigDto>({
        method: 'GET',
        url: `/api/v1/merchant/${merchantId}/config`,
        headers: bearer(agentInternal),
      });

      const fees = res.data!.fees;
      const configured = fees.filter(
        (entry) => entry.merchantFeeConfig !== null,
      );

      // Every base fee in the catalogue is listed for every merchant; what
      // differs is which of them carry an override.
      expect(
        configured.map((entry) => entry.baseFeeConfig.code).sort(),
      ).toEqual([...plan.codes].sort());

      for (const entry of configured) {
        const expected = merchantFeeFor(
          baseFeeByCode.get(entry.baseFeeConfig.code)!,
          plan.agentCut,
        );
        expect(entry.merchantFeeConfig!.baseFeeId).toEqual(expected.baseFeeId);
        expect(Number(entry.merchantFeeConfig!.feeInternalFixed)).toEqual(
          Number(expected.feeInternalFixed),
        );
        expect(Number(entry.merchantFeeConfig!.feeInternalPercentage)).toEqual(
          Number(expected.feeInternalPercentage),
        );
        expect(Number(entry.merchantFeeConfig!.feeAgentFixed)).toEqual(
          Number(expected.feeAgentFixed),
        );
        expect(Number(entry.merchantFeeConfig!.feeAgentPercentage)).toEqual(
          Number(expected.feeAgentPercentage),
        );
      }

      // The row-order hazard, asserted: at most one configured row per
      // (paymentMethodName, transactionType), because that is all
      // findFirstOrThrow filters on. A second one would route to whichever
      // provider Postgres happened to return.
      const pairings = configured.map(
        (entry) =>
          `${entry.baseFeeConfig.paymentMethodName}|${entry.baseFeeConfig.transactionType}`,
      );
      expect(new Set(pairings).size).toEqual(pairings.length);

      // An agent cut with no shareholder row is money owed to nobody, so the
      // two have to agree. `agentShareholders` is null rather than [] when
      // there are none - findAllConfigByMerchantId collapses the empty case.
      const shareholders = res.data!.agentShareholders;
      if (plan.agentCut) {
        expect(shareholders).not.toBeNull();
        expect(
          shareholders!.reduce(
            (sum, holder) => sum + Number(holder.percentagePerAgent),
            0,
          ),
        ).toEqual(100);
      } else {
        expect(shareholders).toBeNull();
      }
    }
  });

  /**
   * The onboarding gap, kept open on purpose. A merchant with no fee row is
   * authenticated and well-formed and still cannot transact - `resolveProvider`
   * answers 403 rather than 500, and this is the fixture that proves there is
   * something for it to answer about.
   */
  it('merchant4 has no routing', async () => {
    const merchantId = merchantIdByEmail.get(MERCHANT_4)!;

    const res = await callDashboard<MerchantConfigDto>({
      method: 'GET',
      url: `/api/v1/merchant/${merchantId}/config`,
      headers: bearer(agentInternal),
    });

    expect(res.data!.fees.length).toBeGreaterThan(0);
    expect(
      res.data!.fees.every((entry) => entry.merchantFeeConfig === null),
    ).toBe(true);
  });
});

/*
 * Noted while writing this, not fixed:
 *
 * `GET /super-admin/base-fee` is documented as the configuration view that is
 * deliberately wider than `GET /fee/config` - "including inactive and
 * soft-deleted rows", on the grounds that "a row it cannot show is a row the
 * operator cannot repair" and that it is "the only way a tombstone is
 * visible". It does return those rows, but `BaseFeeDto` carries neither
 * `isActive` nor `deletedAt`, so an inactive row, a tombstone and a live row
 * are indistinguishable in the response. The extra rows are there and the
 * reason for wanting them is not served.
 */
