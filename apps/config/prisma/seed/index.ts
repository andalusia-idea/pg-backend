import { PrismaClient } from '@config/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { configDevSeed } from './config-dev.seed';

/**
 * config seeder - development fixtures only.
 *
 *   npm run prisma:seed:config        nothing to do, and says so
 *   npm run prisma:seed:config:dev    development fixtures
 *
 * There is no engine tier any more. Every piece of config engine data is
 * written by a migration, so a fresh database holds it before any seed runs and
 * a production cutover does not depend on a seed step at all:
 *
 *   20261105170000_named_principals              Agent Internal's config.Agent row
 *   20261105200000_provider_and_payment_methods  the INTERNAL provider and the
 *                                                payment-method vocabulary
 *   20261106090000_bank_catalogue                the 95-row bank catalogue
 *
 * This file stays rather than going the way of the engine seeders it used to
 * call: prisma.config.ts names it as the seed entry point, `prisma migrate
 * reset` invokes it, and the dev tier arrives through the same script. With no
 * `--dev` it reports that there is nothing to do, which distinguishes "ran, and
 * nothing was needed" from "never ran".
 *
 * The DEV tier needs the auth seeder to have run first: it resolves
 * `config.Merchant.id` and `config.Agent.id` from the matching `auth.User`
 * rows, and skips what it cannot find.
 *
 * Every step is idempotent, so re-running only fills in what is missing.
 *
 * ---
 * `--dev` reaches this script the same way it does the auth seeder: Prisma
 * spawns the seed as a child process, so `prisma db seed` needs a `--` separator
 * before forwarded flags. `prisma:seed:config` therefore ends in a bare `--` so
 * `npm run prisma:seed:config -- --dev` still works. That trailing `--` looks
 * like a typo but is load-bearing - without it the dev tier is skipped silently
 * rather than erroring.
 */

const dsn = process.env.POSTGRESQL_URL_MASTER;
if (!dsn) {
  throw new Error(
    'POSTGRESQL_URL_MASTER is not set. Run via `npm run prisma:seed:config`, ' +
      'which loads apps/config/.env.local.',
  );
}

const pool = new Pool({ connectionString: dsn });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const isProduction = process.env.NODE_ENV === 'production';
const devRequested = process.argv.includes('--dev');

async function main(): Promise<void> {
  console.log(
    `Seeding config  [NODE_ENV=${process.env.NODE_ENV ?? 'unset'}] [dev fixtures: ${devRequested}]`,
  );

  if (!devRequested) {
    console.log(
      '\nNothing to seed - all config engine data is written by migrations.' +
        '\nPass --dev for the development fixtures.',
    );
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
  await configDevSeed(prisma);
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
