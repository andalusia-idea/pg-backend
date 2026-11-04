import { SettlementConfig } from '@app/configuration';
import { PrismaConnectionRegistry } from '@app/prisma';
import { Provider } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@transaction/prisma';
import { Pool } from 'pg';

export const PRISMA_MASTER_TRANSACTION_PROVIDER_KEY = Symbol(
  'PRISMA_MASTER_TRANSACTION_PROVIDER_KEY',
);

export const PrismaMasterTransactionProvider: Provider = {
  provide: PRISMA_MASTER_TRANSACTION_PROVIDER_KEY,
  useFactory: (
    settlementConfig: SettlementConfig,
    registry: PrismaConnectionRegistry,
  ) => {
    const dsn = settlementConfig.POSTGRESQL_URL_MASTER_TRANSACTION;
    if (!dsn)
      throw new Error('POSTGRESQL_URL_MASTER_TRANSACTION is not defined');
    const pool = new Pool({ connectionString: dsn });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({
      adapter,
      log: ['query', 'info', 'warn', 'error'],
    });
    registry.register('transaction-master', client, pool);
    return client;
  },
  inject: [SettlementConfig, PrismaConnectionRegistry],
};

export const PRISMA_SLAVE_TRANSACTION_PROVIDER_KEY = Symbol(
  'PRISMA_SLAVE_TRANSACTION_PROVIDER_KEY',
);

export const PrismaSlaveTransactionProvider: Provider = {
  provide: PRISMA_SLAVE_TRANSACTION_PROVIDER_KEY,
  useFactory: (
    settlementConfig: SettlementConfig,
    registry: PrismaConnectionRegistry,
  ) => {
    const dsn = settlementConfig.POSTGRESQL_URL_SLAVE_TRANSACTION;
    if (!dsn)
      throw new Error('POSTGRESQL_URL_SLAVE_TRANSACTION is not defined');
    const pool = new Pool({ connectionString: dsn });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({
      adapter,
      log: ['query', 'info', 'warn', 'error'],
    });
    registry.register('transaction-slave', client, pool);
    return client;
  },
  inject: [SettlementConfig, PrismaConnectionRegistry],
};
