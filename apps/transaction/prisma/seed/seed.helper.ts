import { PrismaClient } from '@transaction/prisma';

export function logSeeded(label: string, count: number | string): void {
  console.log(`  ${label.padEnd(28)} ${count}`);
}

/**
 * Transaction rows carry ids that belong to other schemas - `merchantId` and
 * `agentId` are `auth.User` ids, the same convention `config.Merchant.id` and
 * `config.Agent.id` follow. There is no foreign key across schemas to enforce it.
 *
 * The transaction client is scoped to `schemas = ["transaction"]`, so it cannot
 * reach `auth.User` through the model API. It is the same physical database
 * though, so a seed can resolve ids with a raw query - which is what config's
 * seeder does, and what this one should do rather than hardcoding ids.
 *
 * Unused until there is fixture data to write. Kept here so the eventual dev
 * tier does not reach for hardcoded ids as the path of least resistance.
 */
export async function findAuthUserIdsByEmail(
  prisma: PrismaClient,
  emails: string[],
): Promise<Map<string, number>> {
  if (emails.length === 0) return new Map();

  const rows = await prisma.$queryRaw<{ id: number; email: string }[]>`
    SELECT id, email FROM auth."User"
    WHERE email = ANY(${emails}) AND "deletedAt" IS NULL
  `;

  return new Map(rows.map((row) => [row.email, row.id]));
}
