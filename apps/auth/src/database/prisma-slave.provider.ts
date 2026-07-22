import { AppConfig } from '@app/configuration';
import { Provider } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@auth/prisma';

export const PRISMA_SLAVE_PROVIDER_KEY = Symbol('PRISMA_MASTER_PROVIDER_KEY');

export const PrismaSlaveProvider: Provider = {
  provide: PRISMA_SLAVE_PROVIDER_KEY,
  useFactory: (appConfig: AppConfig) => {
    const dsn = appConfig.DATABASE_URL_SLAVE;
    if (!dsn) throw new Error('DATABASE_URL_SLAVE is not defined');
    const adapter = new PrismaPg({ connectionString: dsn });

    const prisma = new PrismaClient({
      adapter,
      log: ['query', 'info', 'warn', 'error'],
    });

    return prisma;
  },
  inject: [AppConfig],
};
