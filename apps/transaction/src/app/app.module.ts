import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/transaction/.env.local', 'apps/transaction/.env'],
    }),
  ],
})
export class AppModule {}
