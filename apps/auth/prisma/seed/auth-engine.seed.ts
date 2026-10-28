import { ROLE_ID, SYSTEM_USER_ID } from '@app/microservice';
import { PrismaClient } from '@auth/prisma';
import { hashPassword, logSeeded, SEED_PASSWORD } from './seed.helper';

export type EngineSeedResult = {
  superAdminUserId: number;
  agentInternalUserId: number;
};

/**
 * MANDATORY - production data.
 *
 * The two accounts the system cannot be administered without:
 *
 * - superadmin     the first account able to sign in and administer
 * - agentinternal  merchants are onboarded by an agent, so the internal team
 *                  needs an agent identity to register them (see D9)
 *
 * **The roles and the 20 machine principals are no longer here.** They moved to
 * the `machine_principals` migration, which pins their ids so application code
 * can name them as constants - `SYSTEM_USER_ID`, `MACHINE_USER_ID`, `ROLE_ID`
 * in `libs/microservice`. `BalanceEntry.createdBy` is NOT NULL, so a webhook or
 * a cron writing a balance has to name the principal that did it, and resolving
 * that by email at runtime meant either a TCP hop to auth or a cross-schema raw
 * query from an app whose Prisma client does not span `auth`.
 *
 * These two stay in the seed deliberately. They are real login credentials, and
 * a hardcoded argon2 hash in a migration would put the production admin
 * password in version control - identical in every environment, and
 * unchangeable without a new migration.
 *
 * They land at ids 21 and 22, because the migration sets `User_id_seq` to 20.
 *
 * Idempotent: upserts on the unique `email`, so re-running is safe and will not
 * rotate passwords or duplicate accounts.
 */
export async function authEngineSeed(
  prisma: PrismaClient,
): Promise<EngineSeedResult> {
  const seedPassword = await hashPassword(SEED_PASSWORD);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@pg.id' },
    create: {
      email: 'superadmin@pg.id',
      password: seedPassword,
      roleId: ROLE_ID.SUPER_ADMIN,
      createdBy: SYSTEM_USER_ID,
      AdminDetail: {
        create: {
          fullname: 'Super Admin',
          address: 'Jl. Super Admin',
          phone: '00000000',
          createdBy: SYSTEM_USER_ID,
        },
      },
    },
    update: {},
    select: { id: true },
  });

  const agentInternal = await prisma.user.upsert({
    where: { email: 'agentinternal@pg.id' },
    create: {
      email: 'agentinternal@pg.id',
      password: seedPassword,
      roleId: ROLE_ID.AGENT,
      createdBy: SYSTEM_USER_ID,
      AgentDetail: {
        create: {
          fullname: 'Agent Internal',
          address: 'Jl. Agent Internal',
          phone: '00000000',
          bankCode: 'default',
          bankName: 'default',
          accountNumber: 'default',
          accountHolderName: 'default',
          createdBy: SYSTEM_USER_ID,
        },
      },
    },
    update: {},
    select: { id: true },
  });

  logSeeded('superadmin@pg.id', `id ${superAdmin.id}`);
  logSeeded('agentinternal@pg.id', `id ${agentInternal.id}`);

  return {
    superAdminUserId: superAdmin.id,
    agentInternalUserId: agentInternal.id,
  };
}
