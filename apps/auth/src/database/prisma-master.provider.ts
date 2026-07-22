import { AppConfig } from '@app/configuration';
import { Provider } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@auth/prisma';
import { auditTrailExtension } from './audit.extension';

export const PRISMA_MASTER_PROVIDER_KEY = Symbol('PRISMA_MASTER_PROVIDER_KEY');

export const PrismaMasterProvider: Provider = {
  provide: PRISMA_MASTER_PROVIDER_KEY,
  useFactory: (appConfig: AppConfig) => {
    const dsn = appConfig.DATABASE_URL_MASTER;
    if (!dsn) throw new Error('DATABASE_URL_MASTER is not defined');
    const adapter = new PrismaPg({ connectionString: dsn });

    const prisma = new PrismaClient({
      adapter,
      log: ['query', 'info', 'warn', 'error'],
    }).$extends(auditTrailExtension);
    return prisma;
  },
  inject: [AppConfig],
};
