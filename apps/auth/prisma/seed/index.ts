import { PrismaClient } from '@auth/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { roleEngineSeed } from './role-engine.seed';
import { authDevSeed } from './auth.dev.seed';
import { authEngineSeed } from './auth.engine.seed';

/**
 * auth seeder.
 *
 *   npm run prisma:seed:auth        engine data only (safe anywhere)
 *   npm run prisma:seed:auth:dev    engine + development fixtures
 *
 * Two tiers:
 *   - ENGINE   roles and the accounts the system cannot boot without. Safe to
 *              run in any environment, including production.
 *   - DEV      sample agents and merchants ported from the legacy seed, so a
 *              fresh local database is usable. Never runs in production.
 *
 * Permissions are deliberately not seeded.
 *
 * Every step is idempotent, so re-running only fills in what is missing.
 *
 * ---
 * On how `--dev` reaches this script:
 *
 * `prisma db seed` spawns the seed command as a child process, so flags only
 * reach here if Prisma is told to forward them - which requires a `--`
 * separator:
 *
 *     prisma db seed --config <path> -- --dev
 *                                    ^^ without this, Prisma treats --dev as
 *                                       its own flag and exits with
 *                                       "unknown or unexpected option"
 *
 * `prisma:seed:auth` therefore ends in a bare `--`, so that
 * `npm run prisma:seed:auth -- --dev` still works (npm appends after it).
 * That trailing `--` looks like a typo but is load-bearing; removing it breaks
 * the flag silently, because the seed then runs with the dev tier skipped
 * rather than erroring.
 *
 * `prisma migrate reset` also runs this seeder, via `migrations.seed` in
 * prisma.config.ts. It passes no arguments, so a reset restores engine data
 * only - which is the right default for a command that wipes the database.
 */

const dsn = process.env.POSTGRESQL_URL_MASTER;
if (!dsn) {
  throw new Error(
    'POSTGRESQL_URL_MASTER is not set. Run via `npm run prisma:seed:auth`, ' +
      'which loads apps/auth/.env.local.',
  );
}

const pool = new Pool({ connectionString: dsn });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const isProduction = process.env.NODE_ENV === 'production';
const devRequested = process.argv.includes('--dev');

async function main(): Promise<void> {
  console.log(
    `Seeding auth  [NODE_ENV=${process.env.NODE_ENV ?? 'unset'}] [dev fixtures: ${devRequested}]`,
  );

  console.log('\nEngine data (mandatory):');
  const roleIds = await roleEngineSeed(prisma);
  const { system01Id } = await authEngineSeed(prisma, roleIds);

  if (!devRequested) {
    console.log('\nDevelopment fixtures skipped (pass --dev to include them).');
    return;
  }

  // Refused rather than silently skipped: someone passing --dev against
  // production is a mistake worth surfacing loudly.
  if (isProduction) {
    throw new Error(
      'Refusing to seed development fixtures with NODE_ENV=production.',
    );
  }

  console.log('\nDevelopment fixtures:');
  await authDevSeed(prisma, roleIds, system01Id);
}

main()
  .then(async () => {
    console.log('\nDone.');
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error('\nSeed failed:', error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
