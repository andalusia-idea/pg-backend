import { DynamicModule, Global, Module } from '@nestjs/common';
import {
  createPrismaMasterProvider,
  createPrismaSlaveProvider,
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
  PrismaClientCtor,
} from './prisma-provider.factory';

export interface PrismaModuleOptions<
  T extends { $extends: (...args: any[]) => any },
> {
  prismaClient: PrismaClientCtor<T>;
  applyMasterExtensions?: (client: T) => T;
}

@Global()
@Module({})
export class PrismaModule {
  static forRoot<T extends { $extends: (...args: any[]) => any }>(
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
      providers: [masterProvider, slaveProvider],
      exports: [masterProvider, slaveProvider],
    };
  }
}
