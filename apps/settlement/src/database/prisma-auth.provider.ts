import { SettlementConfig } from '@app/configuration';
import { Provider } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@auth/prisma';
import { PrismaConnectionRegistry } from '@app/prisma';
import { Pool } from 'pg';

export const PRISMA_MASTER_AUTH_PROVIDER_KEY = Symbol(
  'PRISMA_MASTER_AUTH_PROVIDER_KEY',
);

export const PrismaMasterAuthProvider: Provider = {
  provide: PRISMA_MASTER_AUTH_PROVIDER_KEY,
  useFactory: (
    settlementConfig: SettlementConfig,
    registry: PrismaConnectionRegistry,
  ) => {
    const dsn = settlementConfig.POSTGRESQL_URL_MASTER_AUTH;
    if (!dsn) throw new Error('POSTGRESQL_URL_MASTER_AUTH is not defined');
    const pool = new Pool({ connectionString: dsn });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({
      adapter,
      log: ['query', 'info', 'warn', 'error'],
    });
    registry.register('auth-master', client, pool);
    return client;
  },
  inject: [SettlementConfig, PrismaConnectionRegistry],
};

export const PRISMA_SLAVE_AUTH_PROVIDER_KEY = Symbol(
  'PRISMA_SLAVE_AUTH_PROVIDER_KEY',
);

export const PrismaSlaveAuthProvider: Provider = {
  provide: PRISMA_SLAVE_AUTH_PROVIDER_KEY,
  useFactory: (
    settlementConfig: SettlementConfig,
    registry: PrismaConnectionRegistry,
  ) => {
    const dsn = settlementConfig.POSTGRESQL_URL_SLAVE_AUTH;
    if (!dsn) throw new Error('POSTGRESQL_URL_SLAVE_AUTH is not defined');
    const pool = new Pool({ connectionString: dsn });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({
      adapter,
      log: ['query', 'info', 'warn', 'error'],
    });
    registry.register('auth-slave', client, pool);
    return client;
  },
  inject: [SettlementConfig, PrismaConnectionRegistry],
};
