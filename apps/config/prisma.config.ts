import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma resolves relative to the config file's own directory.
// Config-Relative Path
export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
  },
  // typedSql: {
  //   path: 'prisma/sql',
  // },

  datasource: {
    url: env('POSTGRESQL_URL_MASTER'),
  },
});
