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
import { MotionPayModule } from '../upstream/motionpay';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ClsModule } from 'nestjs-cls';
import { Apiv1Module } from '../api-v1/api.v1.module';

@Module({
  controllers: [AppController],
  providers: [AppService],
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      applyMasterExtensions: (client) => client.$extends(auditTrailExtension),
    }),
    MicroserviceModule,
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),

    Apiv1Module,

    /// Upstream Module
    MotionPayModule,
  ],
})
export class AppModule {}
