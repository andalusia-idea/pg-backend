import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigModuleOptions } from '@nestjs/config';
import { AppConfig } from './app.config';
import { TCPConfig } from './tcp.config';
import { DatabaseConfig } from './database.config';

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
      providers: [AppConfig, TCPConfig, DatabaseConfig],
      exports: [ConfigModule, AppConfig, TCPConfig, DatabaseConfig],
    };
  }
}
