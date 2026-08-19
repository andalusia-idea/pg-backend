import { ROLE } from '@app/microservice';
import { PrismaClient } from '@auth/prisma';
import { logSeeded } from './seed.helper';

/** Role name -> row id, for the seeds that follow. */
export type RoleIds = Record<ROLE, number>;

/**
 * MANDATORY - production data.
 *
 * Without these rows no user can be created at all: `User.roleId` is a required
 * foreign key. This is the one piece of seed data the system genuinely cannot
 * boot without.
 *
 * Keyed by name rather than returned as an array: the previous version
 * destructured `Object.values(ROLE).map(...)` positionally, so reordering the
 * ROLE constant would have silently assigned every user the wrong role.
 *
 * Idempotent by lookup-then-create rather than upsert, because `Role.name`
 * carries no unique constraint - see the note in the seed README.
 */
export async function roleEngineSeed(prisma: PrismaClient): Promise<RoleIds> {
  const ids = {} as RoleIds;

  for (const name of Object.values(ROLE)) {
    const existing = await prisma.role.findFirst({
      where: { name, deletedAt: null },
      select: { id: true },
    });

    ids[name] = existing
      ? existing.id
      : (await prisma.role.create({ data: { name }, select: { id: true } })).id;
  }

  logSeeded('roles', Object.keys(ids).length);
  return ids;
}
