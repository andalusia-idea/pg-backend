import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';
// import { DatabaseModule } from '../database/database.module';
import { MicroserviceClientsModule } from '@app/microservice-clients';
import { LoggerModule } from '@app/logger';
import { HealthModule } from '@app/health';
import { RedisModule } from '@app/redis';
import { PrismaModule } from '@app/prisma';
import { PrismaClient } from '@config/prisma';
import { auditTrailExtension } from '../database/audit.extension';

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
    MicroserviceClientsModule,
  ],
})
export class AppModule {}
