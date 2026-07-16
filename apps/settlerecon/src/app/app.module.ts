import { ConfigurationModule } from '@app/configuration';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    ConfigurationModule.forRoot({
      envFilePath: ['apps/settlerecon/.env.local', 'apps/settlerecon/.env'],
    }),
  ],
})
export class AppModule {}
