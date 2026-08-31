import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionTypeEnum,
} from '@app/microservice';
import { PrismaClient } from '@config/prisma';
import {
  AGENT_INTERNAL_EMAIL,
  DEFAULT_RECONCILIATION_TIME,
  findAuthUserIdsByEmail,
  logSeeded,
} from './seed.helper';

/** Must match the emails the auth dev seed creates. */
const DEV_AGENT_EMAILS = [1, 2, 3, 4].map((n) => `agent${n}@example.com`);
const DEV_MERCHANT_EMAILS = [1, 2, 3, 4].map((n) => `merchant${n}@example.com`);

/** Legacy seeded its dev merchants at a 1-minute interval for fast testing. */
const DEV_SETTLEMENT_INTERVAL_MINUTES = 1;

/**
 * Third-party providers.
 *
 * DEVELOPMENT ONLY. Every provider except INTERNAL is a commercial integration -
 * it exists in a given environment because a contract was signed and credentials
 * were issued, not because the code knows its name. Seeding MOTIONPAY into
 * production would put a routable provider in the dropdowns that nothing is
 * actually wired to.
 *
 * Derived by subtraction rather than listed, so adding a provider to
 * ProviderNameEnum puts it here automatically and INTERNAL stays in the engine
 * tier without anyone having to remember the rule.
 */
const DEV_PROVIDERS = Object.values(ProviderNameEnum).filter(
  (name) => name !== ProviderNameEnum.INTERNAL,
);

/**
 * Provider fee configuration.
 *
 * DEVELOPMENT ONLY, and this is the deliberate part: these are **invented
 * rates**, structurally modelled on the legacy PAKAIDONK entries but pointed at
 * MOTIONPAY, since PAKAIDONK is no longer in ProviderNameEnum.
 *
 * Real provider rates are commercial terms from a signed agreement. They must be
 * entered deliberately - through the dashboard's fee-config screens - not seeded
 * from a guess. A production database with plausible-looking but fictional fee
 * rates is worse than one with none, because nothing fails loudly; the fees are
 * simply wrong and every settlement quietly mis-splits.
 */
const DEV_BASE_FEES = [
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.QRIS,
    transactionType: TransactionTypeEnum.PURCHASE,
    feeProviderFixed: '0',
    feeProviderPercentage: '0.8',
  },
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.QRIS,
    transactionType: TransactionTypeEnum.TOPUP,
    feeProviderFixed: '0',
    feeProviderPercentage: '0.8',
  },
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
    transactionType: TransactionTypeEnum.DISBURSEMENT,
    feeProviderFixed: '1200',
    feeProviderPercentage: '0',
  },
  {
    providerName: ProviderNameEnum.MOTIONPAY,
    paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
    transactionType: TransactionTypeEnum.WITHDRAW,
    feeProviderFixed: '1200',
    feeProviderPercentage: '0',
  },
  {
    providerName: ProviderNameEnum.INTERNAL,
    paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
    transactionType: TransactionTypeEnum.TOPUP,
    feeProviderFixed: '0',
    feeProviderPercentage: '0',
  },
];

/**
 * A base fee's identity, mirroring `@@unique([providerName, paymentMethodName,
 * transactionType])`.
 *
 * This replaces the old `code` column, which stored the same triple as one
 * pre-joined string. The column only ever *looked* like a constraint: nothing
 * checked that `code` agreed with the three fields it was built from, so a
 * single typo would have created a second row for a triple that is supposed to
 * be unique. The database now enforces the triple directly, and this rebuilds
 * the string locally where a map key is genuinely needed.
 */
const baseFeeKey = (fee: {
  providerName: string;
  paymentMethodName: string;
  transactionType: string;
}) => `${fee.providerName}:${fee.paymentMethodName}:${fee.transactionType}`;

/**
 * DEVELOPMENT ONLY - never run against production.
 *
 * The config-side counterpart to the auth dev seed: the third-party providers, a
 * config row for each dev agent and merchant, provider fee config, per-merchant
 * fee overrides, and the agent-shareholder splits.
 *
 * Depends on the auth dev seed having run - if those users are missing this
 * skips rather than failing, since `config.Merchant.id` has no foreign key to
 * `auth.User` and would otherwise create orphan rows pointing at nothing.
 *
 * Shareholder splits mirror legacy: merchant1 wholly owned by Agent Internal
 * (whose config.Agent row comes from the engine tier),
 * merchant2 split three ways. Each merchant's shares total exactly 100%, which
 * is the rule `upsertAgentShareholder` enforces on the dashboard.
 */
export async function configDevSeed(prisma: PrismaClient): Promise<boolean> {
  const emails = [
    AGENT_INTERNAL_EMAIL,
    ...DEV_AGENT_EMAILS,
    ...DEV_MERCHANT_EMAILS,
  ];
  const userIds = await findAuthUserIdsByEmail(prisma, emails);

  const missing = emails.filter((email) => !userIds.has(email));
  if (missing.length > 0) {
    console.log(
      `  skipped - ${missing.length} auth user(s) not found. ` +
        'Run `npm run prisma:seed:auth:dev` first.',
    );
    return false;
  }

  const agentInternalId = userIds.get(AGENT_INTERNAL_EMAIL)!;
  const agentIds = DEV_AGENT_EMAILS.map((email) => userIds.get(email)!);
  const merchantIds = DEV_MERCHANT_EMAILS.map((email) => userIds.get(email)!);

  // config.Agent / config.Merchant reuse the auth user id as their own primary
  // key - the same thing registerMerchant does at runtime.
  //
  // Agent Internal is deliberately absent here: its config.Agent row is engine
  // data, created by configEngineSeed. This tier only borrows its id for the
  // shareholder splits below.
  await prisma.$transaction(
    agentIds.map((id) =>
      prisma.agent.upsert({
        where: { id },
        create: { id },
        update: {},
        select: { id: true },
      }),
    ),
  );

  await prisma.$transaction(
    merchantIds.map((id) =>
      prisma.merchant.upsert({
        where: { id },
        create: { id, settlementInterval: DEV_SETTLEMENT_INTERVAL_MINUTES },
        update: {},
        select: { id: true },
      }),
    ),
  );

  // Must precede the base fees - BaseFee.providerName is a real foreign key to
  // Provider.name, so a MOTIONPAY fee row cannot be written before MOTIONPAY is.
  await prisma.$transaction(
    DEV_PROVIDERS.map((name) =>
      prisma.provider.upsert({
        where: { name },
        create: { name, reconciliationTime: DEFAULT_RECONCILIATION_TIME },
        update: {},
        select: { name: true },
      }),
    ),
  );

  const baseFees = await prisma.$transaction(
    DEV_BASE_FEES.map((fee) =>
      prisma.baseFee.upsert({
        where: {
          providerName_paymentMethodName_transactionType: {
            providerName: fee.providerName,
            paymentMethodName: fee.paymentMethodName,
            transactionType: fee.transactionType,
          },
        },
        create: fee,
        update: {},
        select: {
          id: true,
          providerName: true,
          paymentMethodName: true,
          transactionType: true,
        },
      }),
    ),
  );
  const baseFeeIdByKey = new Map(baseFees.map((f) => [baseFeeKey(f), f.id]));

  // Fee overrides for the first two merchants only, mirroring legacy: merchant1
  // is internal-only (no agent cut), merchant2 pays an agent share as well.
  const merchantFees = [
    ...DEV_BASE_FEES.map((fee) => ({
      merchantId: merchantIds[0],
      baseFeeId: baseFeeIdByKey.get(baseFeeKey(fee))!,
      feeInternalFixed: fee.feeProviderFixed === '0' ? '0' : '600',
      feeInternalPercentage: fee.feeProviderPercentage === '0' ? '0' : '0.4',
      feeAgentFixed: '0',
      feeAgentPercentage: '0',
    })),
    ...DEV_BASE_FEES.map((fee) => ({
      merchantId: merchantIds[1],
      baseFeeId: baseFeeIdByKey.get(baseFeeKey(fee))!,
      feeInternalFixed: fee.feeProviderFixed === '0' ? '0' : '600',
      feeInternalPercentage: fee.feeProviderPercentage === '0' ? '0' : '0.4',
      feeAgentFixed: fee.feeProviderFixed === '0' ? '0' : '100',
      feeAgentPercentage: fee.feeProviderPercentage === '0' ? '0' : '0.2',
    })),
  ];

  await prisma.$transaction(
    merchantFees.map((fee) =>
      prisma.merchantFee.upsert({
        where: {
          merchantId_baseFeeId: {
            merchantId: fee.merchantId,
            baseFeeId: fee.baseFeeId,
          },
        },
        create: fee,
        update: {},
        select: { id: true },
      }),
    ),
  );

  // Each merchant's shares must total exactly 100%.
  const shareholders = [
    {
      merchantId: merchantIds[0],
      agentId: agentInternalId,
      percentagePerAgent: '100',
    },
    {
      merchantId: merchantIds[1],
      agentId: agentIds[0],
      percentagePerAgent: '10',
    },
    {
      merchantId: merchantIds[1],
      agentId: agentIds[1],
      percentagePerAgent: '60',
    },
    {
      merchantId: merchantIds[1],
      agentId: agentIds[2],
      percentagePerAgent: '30',
    },
    {
      merchantId: merchantIds[2],
      agentId: agentInternalId,
      percentagePerAgent: '100',
    },
    {
      merchantId: merchantIds[3],
      agentId: agentIds[3],
      percentagePerAgent: '100',
    },
  ];

  await prisma.$transaction(
    shareholders.map((shareholder) =>
      prisma.agentShareholder.upsert({
        where: {
          agentId_merchantId: {
            agentId: shareholder.agentId,
            merchantId: shareholder.merchantId,
          },
        },
        create: shareholder,
        update: {},
        select: { id: true },
      }),
    ),
  );

  logSeeded('config agents', agentIds.length);
  logSeeded('config merchants', merchantIds.length);
  logSeeded(
    'dev providers',
    `${DEV_PROVIDERS.length} (${DEV_PROVIDERS.join(', ')})`,
  );
  logSeeded('base fees', DEV_BASE_FEES.length);
  logSeeded('merchant fee overrides', merchantFees.length);
  logSeeded('agent shareholders', shareholders.length);
  return true;
}
