import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigurationModule } from '@app/configuration';
import { LoggerModule } from '@app/logger';
import { HealthModule } from '@app/health';
import { RedisModule } from '@app/redis';
import { PrismaModule } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { auditTrailExtension } from '../database/audit.extension';

@Module({
  controllers: [AppController],
  providers: [AppService],
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/dashboard/.env.local', 'apps/dashboard/.env'],
    }),
    LoggerModule,
    HealthModule,
    RedisModule,
    PrismaModule.forRoot({
      prismaClient: PrismaClient,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      applyMasterExtensions: (client) => client.$extends(auditTrailExtension),
    }),
  ],
})
export class AppModule {}
