import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';
// import { DatabaseModule } from '../database/database.module';
import { PrismaModule } from '@app/prisma';
import { HealthModule } from '@app/health';
import { PrismaClient } from '@transaction/prisma';
import { auditTrailExtension } from '../database/audit.extension';
import { RedisModule } from '@app/redis';
import { LoggerModule } from '@app/logger';
import { MicroserviceModule } from '@app/microservice';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/transaction/.env.local', 'apps/transaction/.env'],
    }),
    LoggerModule,
    HealthModule,
    RedisModule,
    // DatabaseModule,
    PrismaModule.forRoot({
      prismaClient: PrismaClient,
      applyMasterExtensions: (client) => client.$extends(auditTrailExtension),
    }),
    MicroserviceModule,
  ],
})
export class AppModule {}
