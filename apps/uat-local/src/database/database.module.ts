import { Global, Module } from '@nestjs/common';
import {
  PrismaMasterAuthProvider,
  PrismaSlaveAuthProvider,
} from './prisma-auth.provider';
import {
  PrismaMasterConfigProvider,
  PrismaSlaveConfigProvider,
} from './prisma-config.provider';
import {
  PrismaMasterTransactionProvider,
  PrismaSlaveTransactionProvider,
} from './prisma-transaction.provider';
import { PrismaConnectionRegistry } from '@app/prisma';

@Global()
@Module({
  providers: [
    PrismaConnectionRegistry,
    PrismaMasterAuthProvider,
    PrismaSlaveAuthProvider,
    PrismaMasterConfigProvider,
    PrismaSlaveConfigProvider,
    PrismaMasterTransactionProvider,
    PrismaSlaveTransactionProvider,
  ],
  exports: [
    PrismaMasterAuthProvider,
    PrismaSlaveAuthProvider,
    PrismaMasterConfigProvider,
    PrismaSlaveConfigProvider,
    PrismaMasterTransactionProvider,
    PrismaSlaveTransactionProvider,
  ],
})
export class DatabaseModule {}
