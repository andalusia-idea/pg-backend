import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '@app/redis';
import { LoggerModule } from '@app/logger';
import { MicroserviceClientsModule } from '@app/microservice-clients';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/auth/.env.local', 'apps/auth/.env'],
    }),
    LoggerModule,
    DatabaseModule,
    RedisModule,
    MicroserviceClientsModule,
  ],
})
export class AppModule {}
