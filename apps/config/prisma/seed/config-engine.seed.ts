import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionTypeEnum,
} from '@app/microservice';
import { PrismaClient } from '@config/prisma';
import {
  AGENT_INTERNAL_EMAIL,
  DEFAULT_RECONCILIATION_TIME,
  logSeeded,
  SYSTEM_01_EMAIL,
} from './seed.helper';

/**
 * INTERNAL is the house provider - transactions we settle ourselves rather than
 * route to a third party. It is not an integration, so it exists in every
 * environment unconditionally.
 *
 * Every other member of ProviderNameEnum is a commercial integration whose
 * presence depends on a signed agreement, so those are seeded by the dev tier.
 */
const ENGINE_PROVIDERS = [ProviderNameEnum.INTERNAL];

/**
 * Which transaction types each payment method can serve.
 *
 * Drives the dashboard's `common/div?div=PAYMENT_METHOD_*` dropdowns, which
 * filter on `transactionTypes has <type>`.
 */
const PAYMENT_METHODS: {
  name: PaymentMethodNameEnum;
  explain: string;
  transactionTypes: TransactionTypeEnum[];
}[] = [
  {
    name: PaymentMethodNameEnum.QRIS,
    explain: 'QRIS',
    transactionTypes: [TransactionTypeEnum.PURCHASE],
  },
  {
    name: PaymentMethodNameEnum.VIRTUALACCOUNT,
    explain: 'VIRTUAL_ACCOUNT',
    transactionTypes: [TransactionTypeEnum.PURCHASE],
  },
  {
    name: PaymentMethodNameEnum.DIRECTEWALLET,
    explain: 'DIRECT_E_WALLET',
    transactionTypes: [TransactionTypeEnum.PURCHASE],
  },
  {
    name: PaymentMethodNameEnum.TRANSFERBANK,
    explain: 'TRANSFER_BANK',
    transactionTypes: [
      TransactionTypeEnum.TOPUP,
      TransactionTypeEnum.DISBURSEMENT,
      TransactionTypeEnum.WITHDRAW,
    ],
  },
  {
    name: PaymentMethodNameEnum.TRANSFEREWALLET,
    explain: 'TRANSFER_E_WALLET',
    transactionTypes: [
      TransactionTypeEnum.DISBURSEMENT,
      TransactionTypeEnum.WITHDRAW,
    ],
  },
];

/**
 * MANDATORY - production data.
 *
 * Three things production cannot run without:
 *
 * 1. **Agent Internal's config row.** Merchants are onboarded by an agent, and
 *    the internal team signs in as `agentinternal@pg.id` to do it. Its
 *    `auth.User` + `AgentDetail` come from the auth engine seed; the matching
 *    `config.Agent` row belongs here. Without it, `registerMerchant`'s
 *    `registrarIsAgent` lookup misses and no AgentShareholder row is created -
 *    a silent failure, since the merchant is still registered successfully.
 *
 * 2. **The INTERNAL provider.** Third-party providers are contract-dependent and
 *    belong to the dev tier; INTERNAL is ours, and nothing can be routed or
 *    priced without it.
 *
 * 3. **Payment methods**, the routing vocabulary every BaseFee and transaction
 *    references.
 *
 * Runs AFTER the auth engine seed: the two user ids are resolved by email rather
 * than hardcoded. They are stable in practice (agentinternal lands on id 22 on a
 * fresh database) but only while the engine account counts stay put - bumping
 * SCHEDULER_COUNT would shift every id after it. There is no foreign key from
 * `config.Agent` to `auth.User`, so a wrong id would not error; it would just
 * point at nothing. One query removes that whole class of problem.
 */
export async function configEngineSeed(prisma: PrismaClient): Promise<void> {
  // const userIds = await findAuthUserIdsByEmail(prisma, [
  //   AGENT_INTERNAL_EMAIL,
  //   SYSTEM_01_EMAIL,
  // ]);

  // const agentInternalId = userIds.get(AGENT_INTERNAL_EMAIL);
  // const system01Id = userIds.get(SYSTEM_01_EMAIL);

  const agentInternalId = 22;
  const system01Id = 1;

  if (!agentInternalId || !system01Id) {
    throw new Error(
      `Auth engine data missing (${AGENT_INTERNAL_EMAIL}, ${SYSTEM_01_EMAIL}). ` +
        'Run `npm run prisma:seed:auth` first.',
    );
  }

  await prisma.agent.upsert({
    where: { id: agentInternalId },
    create: { id: agentInternalId, createdBy: system01Id },
    update: {},
    select: { id: true },
  });

  await prisma.$transaction(
    ENGINE_PROVIDERS.map((name) =>
      prisma.provider.upsert({
        where: { name },
        create: {
          name,
          reconciliationTime: DEFAULT_RECONCILIATION_TIME,
          createdBy: system01Id,
        },
        update: {},
        select: { name: true },
      }),
    ),
  );

  await prisma.$transaction(
    PAYMENT_METHODS.map((method) =>
      prisma.paymentMethod.upsert({
        where: { name: method.name },
        create: { ...method, createdBy: system01Id },
        update: {},
        select: { name: true },
      }),
    ),
  );

  logSeeded('agent internal', `config.Agent id ${agentInternalId}`);
  logSeeded(
    'providers',
    `${ENGINE_PROVIDERS.length} (${ENGINE_PROVIDERS.join(', ')})`,
  );
  logSeeded('payment methods', PAYMENT_METHODS.length);
}
