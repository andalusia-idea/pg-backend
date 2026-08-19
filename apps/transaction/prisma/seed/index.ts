import { PrismaClient } from '@transaction/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { transactionDevSeed } from './transaction-dev.seed';
import { transactionEngineSeed } from './transaction-engine.seed';

/**
 * transaction seeder.
 *
 *   npm run prisma:seed:transaction        engine data only (safe anywhere)
 *   npm run prisma:seed:transaction:dev    engine + development fixtures
 *
 * **A frame. Both tiers are currently empty**, matching the structure of the auth
 * and config seeders so that this app behaves the same way as the other two:
 * `prisma migrate reset` completes without a missing-seed error, and the scripts
 * exist where anyone would look for them.
 *
 * Two tiers, same contract as the other apps:
 *   - ENGINE   data the system cannot boot without. Safe in any environment,
 *              including production. Nothing qualifies here - this schema holds
 *              only recorded activity, so an empty production schema is correct.
 *   - DEV      sample transactions and balance history. None chosen yet.
 *
 * Every step must stay idempotent as it is filled in, so re-running only fills in
 * what is missing. Note that the transaction tables make this harder than it was
 * for auth and config: `code` defaults to a uuid, so upserting requires supplying
 * a deterministic code rather than letting the default fire.
 *
 * ---
 * `--dev` reaches this script the same way it does the other two seeders: Prisma
 * spawns the seed as a child process, so `prisma db seed` needs a `--` separator
 * before forwarded flags. `prisma:seed:transaction` therefore ends in a bare `--`
 * so `npm run prisma:seed:transaction -- --dev` still works. That trailing `--`
 * looks like a typo but is load-bearing - without it the dev tier is skipped
 * silently rather than erroring.
 *
 * `prisma migrate reset` also runs this seeder, via `migrations.seed` in
 * prisma.config.ts. It passes no arguments, so a reset restores engine data only -
 * the right default for a command that wipes the database.
 */

const dsn = process.env.POSTGRESQL_URL_MASTER;
if (!dsn) {
  throw new Error(
    'POSTGRESQL_URL_MASTER is not set. Run via `npm run prisma:seed:transaction`, ' +
      'which loads apps/transaction/.env.local.',
  );
}

const pool = new Pool({ connectionString: dsn });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const isProduction = process.env.NODE_ENV === 'production';
const devRequested = process.argv.includes('--dev');

async function main(): Promise<void> {
  console.log(
    `Seeding transaction  [NODE_ENV=${process.env.NODE_ENV ?? 'unset'}] [dev fixtures: ${devRequested}]`,
  );

  console.log('\nEngine data (mandatory):');
  await transactionEngineSeed(prisma);

  if (!devRequested) {
    console.log('\nDevelopment fixtures skipped (pass --dev to include them).');
    return;
  }

  // Refused rather than silently skipped: someone passing --dev against
  // production is a mistake worth surfacing loudly. In place before there are
  // any fixtures, so it cannot be forgotten once there are.
  if (isProduction) {
    throw new Error(
      'Refusing to seed development fixtures with NODE_ENV=production.',
    );
  }

  console.log('\nDevelopment fixtures:');
  await transactionDevSeed(prisma);
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
