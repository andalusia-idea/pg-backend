import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma resolves relative to the config file's own directory.
// Config-Relative Path
export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',

    // NOT config-relative. `schema` and `migrations.path` resolve against this
    // file's directory, but the seed command is spawned from the working
    // directory Prisma was invoked in - the repo root - so this path is
    // repo-relative.
    seed: 'tsx apps/config/prisma/seed',
  },
  // typedSql: {
  //   path: 'prisma/sql',
  // },

  datasource: {
    url: env('POSTGRESQL_URL_MASTER'),
  },
});
