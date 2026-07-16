import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigModuleOptions } from '@nestjs/config';
import { AppConfig } from './app.config';

@Global()
@Module({})
export class ConfigurationModule {
  static forRoot(options: ConfigModuleOptions = {}): DynamicModule {
    return {
      module: ConfigurationModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          ...options,
        }),
      ],
      providers: [AppConfig],
      exports: [ConfigModule, AppConfig],
    };
  }
}
