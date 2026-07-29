import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';
// import { DatabaseModule } from '../database/database.module';
import { LoggerModule } from '@app/logger';
import { HealthModule } from '@app/health';
import { RedisModule } from '@app/redis';
import { PrismaModule } from '@app/prisma';
import { PrismaClient } from '@config/prisma';
import { auditTrailExtension } from '../database/audit.extension';
import { MicroserviceModule } from '@app/microservice';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/config/.env.local', 'apps/config/.env'],
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
