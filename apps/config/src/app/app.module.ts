import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/config/.env.local', 'apps/config/.env'],
    }),
  ],
})
export class AppModule {}
