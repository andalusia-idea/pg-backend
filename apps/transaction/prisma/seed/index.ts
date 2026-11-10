import { PrismaClient } from '@transaction/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { transactionDevSeed } from './transaction-dev.seed';

/**
 * transaction seeder - development fixtures only.
 *
 *   npm run prisma:seed:transaction        nothing to do, and says so
 *   npm run prisma:seed:transaction:dev    development fixtures
 *
 * **There is no engine tier**, which is the right answer twice over. The
 * transaction schema holds recorded activity - transactions, fee details,
 * webhook logs, audits, balance entries - so an empty production copy of it is
 * correct. And the settlement schema riding along in the same migrations no
 * longer needs one either: `UpstreamSettlementWindow` used to be seeded here
 * because the seed was the only way a row could exist, and
 * `POST /super-admin/settlement-window` (D26) has replaced that. A production
 * schedule is now transcribed from the partner notice through the API, like
 * base fees and providers, and the windows in the dev tier are a convenience
 * for a development database rather than data the system boots with.
 *
 *   - DEV      the published upstream settlement windows, plus balance
 *              fixtures across all three buckets. Transaction fixtures are
 *              still unchosen.
 *
 * Every step must stay idempotent, so re-running only fills in what is missing.
 * The dev tier achieves that by **skipping** fixtures already present rather
 * than upserting them: `BalanceEntry` is append-only, so there is nothing to
 * upsert into, and `BalanceService.post()` deliberately throws on a repeat -
 * that strictness is what stops a replayed webhook double-crediting a merchant.
 * A seed therefore has to ask what exists before writing.
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

  if (!devRequested) {
    console.log(
      '\nNothing to seed - the transaction schema holds recorded activity, and' +
        '\nsettlement schedules are entered through the dashboard.' +
        '\nPass --dev for the development fixtures.',
    );
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
