import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigModuleOptions } from '@nestjs/config';
import { AppConfig } from './app.config';
import { TCPConfig } from './tcp.config';
import { DatabaseConfig } from './database.config';
import { JwtConfig } from './jwt.config';
import { MotionPayConfig } from './motionpay.config';
import { MerchantSignatureConfig } from './merchant-signature.config';
import { FeeConfig } from './fee.config';

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
      providers: [
        AppConfig,
        TCPConfig,
        DatabaseConfig,
        JwtConfig,
        MotionPayConfig,
        MerchantSignatureConfig,
        FeeConfig,
      ],
      exports: [
        ConfigModule,
        AppConfig,
        TCPConfig,
        DatabaseConfig,
        JwtConfig,
        MotionPayConfig,
        MerchantSignatureConfig,
        FeeConfig,
      ],
    };
  }
}
