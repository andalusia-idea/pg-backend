import { PrismaClient } from '@config/prisma';

/**
 * Engine accounts created by the auth engine seed. Config depends on both:
 * `agentinternal@pg.id` gets a `config.Agent` row, and `system01@pg.id` is the
 * `createdBy` stamped on every engine row.
 */
export const AGENT_INTERNAL_EMAIL = 'agentinternal@pg.id';
export const SYSTEM_01_EMAIL = 'system01@pg.id';

/** Reconciliation runs at 02:00 unless a provider dictates otherwise. */
export const DEFAULT_RECONCILIATION_TIME = '02:00';

export function logSeeded(label: string, count: number | string): void {
  console.log(`  ${label.padEnd(28)} ${count}`);
}

/**
 * `config.Merchant.id` and `config.Agent.id` are the same value as the owner's
 * `auth.User.id` - there is no foreign key between the schemas, just that
 * convention.
 *
 * Config's Prisma client is scoped to `schemas = ["config"]`, so it cannot read
 * `auth.User` through the model API. It is the same physical database though,
 * so the seed resolves the ids with a raw query.
 *
 * Legacy hardcoded these (agents 12-16, merchants 17-20), which only held while
 * the auth seed produced exactly those ids. It no longer does, and any change to
 * the number of engine accounts would shift them again - so they are looked up.
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
