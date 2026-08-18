import { Provider } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { DatabaseConfig } from '@app/configuration';
import { Pool } from 'pg';

export const PRISMA_MASTER_PROVIDER_KEY = Symbol('PRISMA_MASTER_PROVIDER_KEY');
export const PRISMA_SLAVE_PROVIDER_KEY = Symbol('PRISMA_SLAVE_PROVIDER_KEY');

type PrismaClientLike = {
  $extends: (...args: any[]) => any;
};

export type PrismaClientCtor<T extends PrismaClientLike> = new (
  options: any,
) => T;

export function createPrismaMasterProvider<T extends PrismaClientLike>(
  token: symbol,
  PrismaClientClass: PrismaClientCtor<T>,
  applyExtensions?: (client: T) => T,
): Provider {
  return {
    provide: token,
    useFactory: (databaseConfig: DatabaseConfig) => {
      const dsn = databaseConfig.POSTGRESQL_URL_MASTER;
      if (!dsn) throw new Error('POSTGRESQL_URL_MASTER is not defined');
      const pool = new Pool({ connectionString: dsn });
      const adapter = new PrismaPg(pool);

      const client = new PrismaClientClass({
        adapter,
        log: ['query', 'info', 'warn', 'error'],
      });

      return applyExtensions ? applyExtensions(client) : client;
    },
    inject: [DatabaseConfig],
  };
}

export function createPrismaSlaveProvider<T extends PrismaClientLike>(
  token: symbol,
  PrismaClientClass: PrismaClientCtor<T>,
): Provider {
  return {
    provide: token,
    useFactory: (databaseConfig: DatabaseConfig) => {
      const dsn = databaseConfig.POSTGRESQL_URL_SLAVE;
      if (!dsn) throw new Error('POSTGRESQL_URL_SLAVE is not defined');
      const pool = new Pool({ connectionString: dsn });
      const adapter = new PrismaPg(pool);

      return new PrismaClientClass({
        adapter,
        log: ['query', 'info', 'warn', 'error'],
      });
    },
    inject: [DatabaseConfig],
  };
}
