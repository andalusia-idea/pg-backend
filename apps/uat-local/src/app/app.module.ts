import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigurationModule, envFilePath } from '@app/configuration';
import { LoggerModule } from '@app/logger';
import { RedisModule } from '@app/redis';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database';
import { HealthController } from './health.controller';
import { TerminusModule } from '@nestjs/terminus';

@Module({
  controllers: [AppController, HealthController],
  providers: [AppService],
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: envFilePath('uat-local'),
    }),
    LoggerModule,
    TerminusModule,
    RedisModule,
    DatabaseModule,
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
