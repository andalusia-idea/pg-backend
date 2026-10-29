import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigurationModule } from '@app/configuration';
import { LoggerModule } from '@app/logger';
import { HealthModule } from '@app/health';
import { RedisModule } from '@app/redis';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database';

@Module({
  controllers: [AppController],
  providers: [AppService],
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/uat-local/.env.local', 'apps/uat-local/.env'],
    }),
    LoggerModule,
    HealthModule,
    RedisModule,
    DatabaseModule,
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
