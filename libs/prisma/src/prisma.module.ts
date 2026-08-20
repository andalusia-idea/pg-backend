import { DynamicModule, Global, Module } from '@nestjs/common';
import { PrismaConnectionRegistry } from './prisma-connection.registry';
import {
  createPrismaMasterProvider,
  createPrismaSlaveProvider,
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
  PrismaClientCtor,
  PrismaClientLike,
} from './prisma-provider.factory';

export interface PrismaModuleOptions<T extends PrismaClientLike> {
  prismaClient: PrismaClientCtor<T>;
  applyMasterExtensions?: (client: T) => T;
}

@Global()
@Module({})
export class PrismaModule {
  static forRoot<T extends PrismaClientLike>(
    options: PrismaModuleOptions<T>,
  ): DynamicModule {
    const masterProvider = createPrismaMasterProvider(
      PRISMA_MASTER_PROVIDER_KEY,
      options.prismaClient,
      options.applyMasterExtensions,
    );
    const slaveProvider = createPrismaSlaveProvider(
      PRISMA_SLAVE_PROVIDER_KEY,
      options.prismaClient,
    );

    return {
      module: PrismaModule,
      // The registry must be a provider of this module so Nest instantiates it
      // and runs its onApplicationShutdown hook. Both factories inject it, which
      // guarantees it exists before either pool is created.
      providers: [PrismaConnectionRegistry, masterProvider, slaveProvider],
      exports: [masterProvider, slaveProvider],
    };
  }
}
