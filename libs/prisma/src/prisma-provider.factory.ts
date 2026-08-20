import { Provider } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { DatabaseConfig } from '@app/configuration';
import { Pool } from 'pg';
import { PrismaConnectionRegistry } from './prisma-connection.registry';

export const PRISMA_MASTER_PROVIDER_KEY = Symbol('PRISMA_MASTER_PROVIDER_KEY');
export const PRISMA_SLAVE_PROVIDER_KEY = Symbol('PRISMA_SLAVE_PROVIDER_KEY');

/**
 * `$disconnect` is part of the constraint because the connection registry needs
 * it at shutdown - see PrismaConnectionRegistry for why closing the pool is not
 * enough on its own.
 */
export type PrismaClientLike = {
  $extends: (...args: any[]) => any;
  $disconnect: () => Promise<void>;
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
    useFactory: (
      databaseConfig: DatabaseConfig,
      registry: PrismaConnectionRegistry,
    ) => {
      const dsn = databaseConfig.POSTGRESQL_URL_MASTER;
      if (!dsn) throw new Error('POSTGRESQL_URL_MASTER is not defined');
      const pool = new Pool({ connectionString: dsn });
      const adapter = new PrismaPg(pool);

      const client = new PrismaClientClass({
        adapter,
        log: ['query', 'info', 'warn', 'error'],
      });

      // Registered before extensions are applied: $extends returns a proxy over
      // the same engine, so the base client disconnects both.
      registry.register('master', client, pool);

      return applyExtensions ? applyExtensions(client) : client;
    },
    inject: [DatabaseConfig, PrismaConnectionRegistry],
  };
}

export function createPrismaSlaveProvider<T extends PrismaClientLike>(
  token: symbol,
  PrismaClientClass: PrismaClientCtor<T>,
): Provider {
  return {
    provide: token,
    useFactory: (
      databaseConfig: DatabaseConfig,
      registry: PrismaConnectionRegistry,
    ) => {
      const dsn = databaseConfig.POSTGRESQL_URL_SLAVE;
      if (!dsn) throw new Error('POSTGRESQL_URL_SLAVE is not defined');
      const pool = new Pool({ connectionString: dsn });
      const adapter = new PrismaPg(pool);

      const client = new PrismaClientClass({
        adapter,
        log: ['query', 'info', 'warn', 'error'],
      });

      registry.register('slave', client, pool);

      return client;
    },
    inject: [DatabaseConfig, PrismaConnectionRegistry],
  };
}
