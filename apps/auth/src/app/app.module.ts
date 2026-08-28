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
    // Registered here rather than per-module: `forRoot` sets up the single
    // scheduler registry the whole app shares.
    ScheduleModule.forRoot(),

    // Business Module
    UserModule,
    MerchantSignatureModule,
  ],
})
export class AppModule {}
