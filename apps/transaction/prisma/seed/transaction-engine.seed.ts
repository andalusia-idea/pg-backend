import { PrismaClient } from '@transaction/prisma';

/**
 * MANDATORY - production data.
 *
 * **Empty, and expected to stay that way.**
 *
 * Every table in this schema is a record of something that happened. Transactions
 * are created by merchants through the Open API, fee details are computed at the
 * time each transaction is priced, webhook logs record delivery attempts, audits
 * record state changes, and the three `*BalanceLog` tables are an append-only
 * ledger written only as a side effect of a transaction settling.
 *
 * There is no vocabulary here for the system to boot with - no equivalent of
 * auth's roles or config's banks and payment methods. `TransactionStatusEnum`,
 * `FeeTypeEnum` and `TransactionTypeEnum` are Postgres enum types created by the
 * migration, not seeded rows.
 *
 * So a production transaction schema is correct precisely when it is empty. If
 * something ever does belong here, it belongs in this function; until then the
 * seeder exists so that `prisma migrate reset` and the seed scripts behave the
 * same way for this app as for auth and config.
 */
export async function transactionEngineSeed(
  _prisma: PrismaClient,
): Promise<void> {
  console.log('  nothing to seed - this schema holds only recorded activity.');
}
