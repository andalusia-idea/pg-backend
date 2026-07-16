import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/auth/.env.local', 'apps/auth/.env'],
    }),
  ],
})
export class AppModule {}
