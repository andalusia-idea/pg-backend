import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'apps/dashboard/prisma/schema.prisma',

  /// "never run migrate here"
  // migrations: {
  //   path: 'apps/dashboard/prisma/migrations',
  // },
  // typedSql: {
  //   path: 'apps/auth/prisma/sql',
  // },

  datasource: {
    url: env('POSTGRESQL_URL_MASTER'),
  },
});
