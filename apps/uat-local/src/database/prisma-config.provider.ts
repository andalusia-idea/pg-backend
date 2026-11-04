import { SettlementConfig } from '@app/configuration';
import { Provider } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@config/prisma';
import { Pool } from 'pg';
import { PrismaConnectionRegistry } from '@app/prisma';

export const PRISMA_MASTER_CONFIG_PROVIDER_KEY = Symbol(
  'PRISMA_MASTER_CONFIG_PROVIDER_KEY',
);

export const PrismaMasterConfigProvider: Provider = {
  provide: PRISMA_MASTER_CONFIG_PROVIDER_KEY,
  useFactory: (
    settlementConfig: SettlementConfig,
    registry: PrismaConnectionRegistry,
  ) => {
    const dsn = settlementConfig.POSTGRESQL_URL_MASTER_CONFIG;
    if (!dsn) throw new Error('POSTGRESQL_URL_MASTER_CONFIG is not defined');
    const pool = new Pool({ connectionString: dsn });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({
      adapter,
      log: ['query', 'info', 'warn', 'error'],
    });
    registry.register('config-master', client, pool);
    return client;
  },
  inject: [SettlementConfig, PrismaConnectionRegistry],
};

export const PRISMA_SLAVE_CONFIG_PROVIDER_KEY = Symbol(
  'PRISMA_SLAVE_CONFIG_PROVIDER_KEY',
);

export const PrismaSlaveConfigProvider: Provider = {
  provide: PRISMA_SLAVE_CONFIG_PROVIDER_KEY,
  useFactory: (
    settlementConfig: SettlementConfig,
    registry: PrismaConnectionRegistry,
  ) => {
    const dsn = settlementConfig.POSTGRESQL_URL_SLAVE_CONFIG;
    if (!dsn) throw new Error('POSTGRESQL_URL_SLAVE_CONFIG is not defined');
    const pool = new Pool({ connectionString: dsn });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({
      adapter,
      log: ['query', 'info', 'warn', 'error'],
    });
    registry.register('config-slave', client, pool);
    return client;
  },
  inject: [SettlementConfig, PrismaConnectionRegistry],
};
