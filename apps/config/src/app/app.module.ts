import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/config/.env.local', 'apps/config/.env'],
    }),
    DatabaseModule,
  ],
})
export class AppModule {}
