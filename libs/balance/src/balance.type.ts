import type { Prisma } from '@transaction/prisma';

/**
 * The transaction-scoped client every method here runs inside.
 *
 * `Prisma.TransactionClient` is `Omit<PrismaClient, ITXClientDenyList>` - the
 * same client minus `$transaction`, `$connect` and `$extends`. It is exactly
 * what `prisma.$transaction(async (tx) => ...)` hands the callback, so the
 * signature says "I run inside a transaction" rather than "give me a database".
 *
 * **Known coupling.** Typing this against `@transaction/prisma` points a lib at
 * an app, which is backwards, and `apps/dashboard` uses a different generated
 * client over these same tables (manual adjustment, Step 12). It is deliberate
 * for now: real Prisma types give autocomplete on the delegates and a compile
 * error when `createdBy` is missing, and that NOT NULL enforcement is the whole
 * reason these tables are absent from `AUDITED_MODELS`. A structural
 * `any`-shaped type would trade that away today to solve a problem that is
 * several steps off.
 *
 * When Step 12 lands, widen **this alias**. Nothing else has to change.
 */
export type BalanceTx = Prisma.TransactionClient;
