import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'apps/config/prisma/schema.prisma',

  migrations: {
    path: 'apps/config/prisma/migrations',
  },
  // typedSql: {
  //   path: 'apps/config/prisma/sql',
  // },

  datasource: {
    url: env('POSTGRESQL_URL_MASTER'),
  },
});
