import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionTypeEnum,
} from '@app/microservice';
import { PrismaClient } from '@config/prisma';
import { DEFAULT_RECONCILIATION_TIME, logSeeded } from './seed.helper';

/**
 * The two auth engine accounts config depends on: `agentinternal@pg.id` gets a
 * `config.Agent` row, and `system01@pg.id` is stamped as `createdBy`.
 *
 * Hardcoded deliberately - these are the ids the auth engine seed produces on a
 * fresh database, and that seed is treated as fixed for production data.
 *
 * Nothing verifies them at runtime. There is no foreign key from `config.Agent`
 * to `auth.User`, so a wrong id here does not error, it points at nothing. Two
 * things invalidate them: changing the auth engine seed's account counts (say
 * SCHEDULER_COUNT moving off 10, which shifts every id after it), or running this
 * seed against a database where the auth engine seed never ran. Both are silent.
 */
const AGENT_INTERNAL_USER_ID = 22;
const SYSTEM_01_USER_ID = 1;

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
 * Runs AFTER the auth engine seed - it reuses that seed's user ids. See
 * AGENT_INTERNAL_USER_ID above for what that assumption costs.
 */
export async function configEngineSeed(prisma: PrismaClient): Promise<void> {
  await prisma.agent.upsert({
    where: { id: AGENT_INTERNAL_USER_ID },
    create: { id: AGENT_INTERNAL_USER_ID, createdBy: SYSTEM_01_USER_ID },
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
          createdBy: SYSTEM_01_USER_ID,
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
        create: { ...method, createdBy: SYSTEM_01_USER_ID },
        update: {},
        select: { name: true },
      }),
    ),
  );

  logSeeded('agent internal', `config.Agent id ${AGENT_INTERNAL_USER_ID}`);
  logSeeded(
    'providers',
    `${ENGINE_PROVIDERS.length} (${ENGINE_PROVIDERS.join(', ')})`,
  );
  logSeeded('payment methods', PAYMENT_METHODS.length);
}
