import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '@app/redis';
import { LoggerModule } from '@app/logger';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/auth/.env.local', 'apps/auth/.env'],
    }),
    LoggerModule,
    DatabaseModule,
    RedisModule,
  ],
})
export class AppModule {}
