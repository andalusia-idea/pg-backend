import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MicroserviceClientsModule } from '@app/microservice-clients';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/transaction/.env.local', 'apps/transaction/.env'],
    }),
    DatabaseModule,
    MicroserviceClientsModule,
  ],
})
export class AppModule {}
