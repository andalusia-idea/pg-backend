import { ConfigurationModule, envFilePath } from '@app/configuration';
import { Module } from '@nestjs/common';
// import { DatabaseModule } from '../database/database.module';
import { LoggerModule } from '@app/logger';
import { HealthModule } from '@app/health';
import { RedisModule } from '@app/redis';
import { PrismaModule } from '@app/prisma';
import { PrismaClient } from '@config/prisma';
import { auditTrailExtension } from '../database/audit.extension';
import { MicroserviceModule } from '@app/microservice';
import { FeeModule } from '../fee/fee.module';
import { ProfileProviderModule } from '../profile-provider/profile-provider.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  controllers: [AppController],
  providers: [AppService],
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: envFilePath('config'),
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

    /// Business Module
    FeeModule,
    ProfileProviderModule,
  ],
})
export class AppModule {}
