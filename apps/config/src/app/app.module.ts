import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MicroserviceClientsModule } from '@app/microservice-clients';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/config/.env.local', 'apps/config/.env'],
    }),
    DatabaseModule,
    MicroserviceClientsModule,
  ],
})
export class AppModule {}
