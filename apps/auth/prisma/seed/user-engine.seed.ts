import { ROLE } from '@app/microservice';
import { PrismaClient } from '@auth/prisma';
import { RoleIds } from './role-engine.seed';
import {
  ENGINE_PASSWORD,
  hashPassword,
  logSeeded,
  SEED_PASSWORD,
} from './seed.helper';

const SCHEDULER_COUNT = 10;
const SYSTEM_COUNT = 5;
const RESERVED_COUNT = 5;

/** "01" … "10" */
function serials(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    String(i + 1).padStart(2, '0'),
  );
}

export type EngineSeedResult = {
  /** Audit principal every seeded row is attributed to. */
  system01Id: number;
  superAdminUserId: number;
  agentInternalUserId: number;
};

/**
 * MANDATORY - production data.
 *
 * These are the accounts the engine itself runs as, plus the two humans-facing
 * accounts the system cannot bootstrap without:
 *
 * - scheduler01..10  cron / background workers
 * - system01..05     internal service principals; system01 is the audit
 *                    identity stamped into `createdBy` on every seeded row
 * - reserved01..05   spare system slots, kept so ids stay stable if a new
 *                    machine principal is needed later
 * - superadmin       the first account able to sign in and administer
 * - agentinternal    merchants are onboarded by an agent, so the internal team
 *                    needs an agent identity to register them (see D9)
 *
 * Idempotent: upserts on the unique `email`, so re-running is safe and will not
 * rotate passwords or duplicate accounts.
 */
export async function userEngineSeed(
  prisma: PrismaClient,
  roleIds: RoleIds,
): Promise<EngineSeedResult> {
  const enginePassword = await hashPassword(ENGINE_PASSWORD);

  // system01 must exist before anything else so it can be the createdBy for the
  // rest; machine accounts are therefore seeded before the human-facing ones.
  const systemUsers = await prisma.$transaction(
    serials(SYSTEM_COUNT).map((serial) =>
      prisma.user.upsert({
        where: { email: `system${serial}@pg.id` },
        create: {
          email: `system${serial}@pg.id`,
          password: enginePassword,
          roleId: roleIds[ROLE.SYSTEM],
        },
        update: {},
        select: { id: true },
      }),
    ),
  );
  const system01Id = systemUsers[0].id;

  const reservedUsers = await prisma.$transaction(
    serials(RESERVED_COUNT).map((serial) =>
      prisma.user.upsert({
        where: { email: `reserved${serial}@pg.id` },
        create: {
          email: `reserved${serial}@pg.id`,
          password: enginePassword,
          roleId: roleIds[ROLE.SYSTEM],
          createdBy: system01Id,
        },
        update: {},
        select: { id: true },
      }),
    ),
  );

  const seedPassword = await hashPassword(SEED_PASSWORD);

  const schedulerUsers = await prisma.$transaction(
    serials(SCHEDULER_COUNT).map((serial) =>
      prisma.user.upsert({
        where: { email: `scheduler${serial}@pg.id` },
        create: {
          email: `scheduler${serial}@pg.id`,
          password: enginePassword,
          roleId: roleIds[ROLE.SCHEDULER],
          createdBy: system01Id,
        },
        update: {},
        select: { id: true },
      }),
    ),
  );

  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@pg.id' },
    create: {
      email: 'superadmin@pg.id',
      password: seedPassword,
      roleId: roleIds[ROLE.SUPER_ADMIN],
      createdBy: system01Id,
      AdminDetail: {
        create: {
          fullname: 'Super Admin',
          address: 'Jl. Super Admin',
          phone: '00000000',
          createdBy: system01Id,
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
      roleId: roleIds[ROLE.AGENT],
      createdBy: system01Id,
      AgentDetail: {
        create: {
          fullname: 'Agent Internal',
          address: 'Jl. Agent Internal',
          phone: '00000000',
          bankCode: 'default',
          bankName: 'default',
          accountNumber: 'default',
          accountHolderName: 'default',
          createdBy: system01Id,
        },
      },
    },
    update: {},
    select: { id: true },
  });

  logSeeded('system users', systemUsers.length);
  logSeeded('scheduler users', schedulerUsers.length);
  logSeeded('reserved users', reservedUsers.length);
  logSeeded('superadmin@pg.id', `id ${superAdmin.id}`);
  logSeeded('agentinternal@pg.id', `id ${agentInternal.id}`);

  return {
    system01Id,
    superAdminUserId: superAdmin.id,
    agentInternalUserId: agentInternal.id,
  };
}
