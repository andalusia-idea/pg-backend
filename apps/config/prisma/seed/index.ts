import { PrismaClient } from '@config/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { bankEngineSeed } from './bank-engine.seed';
import { configDevSeed } from './config-dev.seed';

/**
 * config seeder.
 *
 *   npm run prisma:seed:config        engine data only (safe anywhere)
 *   npm run prisma:seed:config:dev    engine + development fixtures
 *
 * Two tiers:
 *   - ENGINE   the bank catalogue. Safe in any environment, including
 *              production.
 *   - DEV      config rows for the dev agents and merchants, provider fee
 *              config, fee overrides and shareholder splits. Never in production.
 *
 * The rest of the engine data is no longer here. Agent Internal's `config.Agent`
 * row, the INTERNAL provider and the payment-method routing vocabulary are
 * written by migrations - `20261105170000_named_principals` and
 * `20261105200000_provider_and_payment_methods` - so a fresh database holds them
 * before any seed runs, and a production cutover does not depend on a seed step
 * at all. Banks are the only engine data still seeded; moving them is the
 * unfinished half of that work.
 *
 * Only the DEV tier needs the auth seeder to have run first: it resolves
 * `config.Merchant.id` and `config.Agent.id` from the matching `auth.User`
 * rows, and skips what it cannot find. The engine tier is independent of auth.
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

  console.log('\nEngine data (mandatory):');
  await bankEngineSeed(prisma);

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
