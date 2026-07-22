import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'apps/auth/prisma/schema.prisma',

  migrations: {
    path: 'apps/auth/prisma/migrations',
  },
  // typedSql: {
  //   path: 'apps/auth/prisma/sql',
  // },

  datasource: {
    url: env('DATABASE_URL_MASTER'),
  },
});
