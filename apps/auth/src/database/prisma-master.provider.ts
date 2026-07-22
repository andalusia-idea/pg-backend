import { Provider } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@auth/prisma';
import { auditTrailExtension } from './audit.extension';
import { DatabaseConfig } from '@app/configuration';

export const PRISMA_MASTER_PROVIDER_KEY = Symbol('PRISMA_MASTER_PROVIDER_KEY');

export const PrismaMasterProvider: Provider = {
  provide: PRISMA_MASTER_PROVIDER_KEY,
  useFactory: (databaseConfig: DatabaseConfig) => {
    const dsn = databaseConfig.POSTGRESQL_URL_MASTER;
    if (!dsn) throw new Error('POSTGRESQL_URL_MASTER is not defined');
    const adapter = new PrismaPg({ connectionString: dsn });

    const prisma = new PrismaClient({
      adapter,
      log: ['query', 'info', 'warn', 'error'],
    }).$extends(auditTrailExtension);
    return prisma;
  },
  inject: [DatabaseConfig],
};
