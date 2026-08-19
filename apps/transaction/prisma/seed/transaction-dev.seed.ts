import { PrismaClient } from '@transaction/prisma';

/**
 * DEVELOPMENT ONLY - never run against production.
 *
 * **Empty by decision, not by oversight.** No fixture data has been chosen yet.
 *
 * When it is, this is the function it goes in. Four things constrain what can be
 * written here, and all four are easy to get wrong:
 *
 * 1. **Ids come from other schemas.** `merchantId` and `agentId` are `auth.User`
 *    ids, matching `config.Merchant.id` / `config.Agent.id`. Nothing enforces
 *    that - there is no cross-schema foreign key - so resolve them with
 *    `findAuthUserIdsByEmail` rather than hardcoding. A wrong id will not error;
 *    it produces a transaction belonging to nobody. Run after the auth and config
 *    dev seeds, and skip loudly if their users are missing.
 *
 * 2. **The balance logs are an append-only ledger.** `MerchantBalanceLog`,
 *    `AgentBalanceLog` and `InternalBalanceLog` have no running-total column -
 *    current balance is the latest row by id. Each row's `balanceActive` must
 *    therefore equal the previous row's plus its own `changeAmount`. Seeded rows
 *    with arbitrary balances produce a ledger that reads as corrupt, and a
 *    balance endpoint that disagrees with its own history.
 *
 * 3. **`code` must be deterministic for the seed to be idempotent.** It is
 *    `@unique @default(uuid())`, so letting the default fire makes re-running
 *    insert duplicates instead of upserting. Supply the real correlation format -
 *    `{timestampMs}{type}{method}{provider}-{userId}[-random]` - with a fixed
 *    timestamp per fixture, and upsert on it.
 *
 * 4. **Fee detail rows must agree with their parent.** Each transaction's fee
 *    columns and its `*FeeDetail` rows are two representations of one
 *    calculation. Seeding them independently is how they drift.
 *
 * Fixtures should also cover the states the dashboard actually filters on -
 * pending, success, failed - and at least one transaction old enough to fall
 * outside a default date range, since that is where listing bugs hide.
 */
export async function transactionDevSeed(_prisma: PrismaClient): Promise<void> {
  console.log('  no fixtures defined yet.');
}
