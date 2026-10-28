import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigurationModule } from '@app/configuration';
import { LoggerModule } from '@app/logger';
import { RedisModule } from '@app/redis';
import { DatabaseModule } from '../database';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { SettlementModule } from '../settlement/settlement.module';

@Module({
  controllers: [AppController, HealthController],
  providers: [AppService],
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/settlement/.env.local', 'apps/settlement/.env'],
    }),
    LoggerModule,
    // Not @app/health: its HealthController injects PRISMA_MASTER_PROVIDER_KEY
    // and PRISMA_SLAVE_PROVIDER_KEY, which only PrismaModule.forRoot provides -
    // and this app has a client per schema instead of one per app. The local
    // HealthController pings the transaction pools by their own tokens.
    //
    // TerminusModule came with @app/health; the local controller injects the
    // same indicators, so it has to be imported here instead.
    TerminusModule,
    RedisModule,
    // PrismaModule.forRoot from @app/prisma replaced by custom DatabaseModule
    DatabaseModule,
    // No need MicroserviceModule, since this apps has access to all schema
    // No need ClsModule, since this apps handle everything manual
    ScheduleModule.forRoot(),

    SettlementModule,
  ],
})
export class AppModule {}
