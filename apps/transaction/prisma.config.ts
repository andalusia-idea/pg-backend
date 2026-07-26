import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'apps/transaction/prisma/schema.prisma',

  migrations: {
    path: 'apps/transaction/prisma/migrations',
  },
  // typedSql: {
  //   path: 'apps/transaction/prisma/sql',
  // },

  datasource: {
    url: env('POSTGRESQL_URL_MASTER'),
  },
});
