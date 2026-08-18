import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * The dashboard must never run migrations.
 *
 * It owns none of these tables - it reads across auth + config + transaction and
 * writes only to the config tables it administers. Each owning app migrates its
 * own schema.
 *
 * This is an active guard rather than a comment because the passive approach
 * does not work: omitting the `migrations` block does NOT stop Prisma, it just
 * falls back to a default `prisma/migrations` path. And the blast radius is the
 * whole system - this schema spans all three namespaces with no migration
 * history, so `migrate dev` here would try to author one migration covering all
 * 29 tables and offer to reset the shared database to do it.
 */
if (process.argv.includes('migrate')) {
  throw new Error(
    'apps/dashboard never runs migrations - it owns none of its tables.\n' +
      'Migrate from the owning app instead:\n' +
      '  npm run prisma:migrate:dev:auth\n' +
      '  npm run prisma:migrate:dev:config\n' +
      '  npm run prisma:migrate:dev:transaction',
  );
}

// Prisma resolves relative to the config file's own directory.
// Config-Relative Path
export default defineConfig({
  schema: 'prisma/schema.prisma',

  // No `migrations` block - see the guard above.

  // typedSql: {
  //   path: 'prisma/sql',
  // },

  datasource: {
    url: env('POSTGRESQL_URL_MASTER'),
  },
});
