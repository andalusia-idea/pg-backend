import { Global, Module } from '@nestjs/common';
import { PrismaMasterProvider } from './prisma-master.provider';
import { PrismaSlaveProvider } from './prisma-slave.provider';

@Global()
@Module({
  providers: [PrismaMasterProvider, PrismaSlaveProvider],
  exports: [PrismaMasterProvider, PrismaSlaveProvider],
})
export class DatabaseModule {}
