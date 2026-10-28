import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';
// import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '@app/redis';
import { LoggerModule } from '@app/logger';
import { HealthModule } from '@app/health';
import { PrismaModule } from '@app/prisma';
import { PrismaClient } from '@auth/prisma';
import { auditTrailExtension } from '../database/audit.extension';
import { MicroserviceModule } from '@app/microservice';
import { ScheduleModule } from '@nestjs/schedule';
import { ClsModule } from 'nestjs-cls';
import { UserModule } from '../user/user.module';
import { MerchantSignatureModule } from '../merchant-signature/merchant-signature.module';

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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      applyMasterExtensions: (client) => client.$extends(auditTrailExtension),
    }),
    MicroserviceModule,

    // No `middleware: { mount: true }`, unlike transaction and dashboard. Those
    // are HTTP apps whose guards put the caller in CLS per request; this one
    // answers TCP messages, where middleware never runs. All this registration
    // buys is an injectable `ClsService`, so a cron can open a context of its
    // own and the audit extension has a userId to stamp.
    ClsModule.forRoot({ global: true }),

    // Registered here rather than per-module: `forRoot` sets up the single
    // scheduler registry the whole app shares.
    ScheduleModule.forRoot(),

    // Business Module
    UserModule,
    MerchantSignatureModule,
  ],
})
export class AppModule {}
