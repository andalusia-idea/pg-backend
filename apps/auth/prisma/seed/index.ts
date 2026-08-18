import { PrismaClient } from '@auth/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const dsn = process.env.POSTGRESQL_URL_MASTER;
const pool = new Pool({ connectionString: dsn });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
