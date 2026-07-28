import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';
// import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '@app/redis';
import { LoggerModule } from '@app/logger';
import { MicroserviceClientsModule } from '@app/microservice-clients';
import { HealthModule } from '@app/health';
import { PrismaModule } from '@app/prisma';
import { PrismaClient } from '@auth/prisma';
import { auditTrailExtension } from '../database/audit.extension';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/auth/.env.local', 'apps/auth/.env'],
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
