import { Global, Module } from '@nestjs/common';
import { FeeCalculateConfigClient, ProfileClient } from './client';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  AUTH_CLIENT,
  CONFIG_CLIENT,
  TRANSACTION_CLIENT,
} from './microservice.constant';
import { ConfigurationModule, TCPConfig } from '@app/configuration';

@Global()
@Module({
  providers: [FeeCalculateConfigClient, ProfileClient],
  exports: [FeeCalculateConfigClient, ProfileClient],
  imports: [
    ClientsModule.registerAsync([
      {
        name: AUTH_CLIENT,
        imports: [ConfigurationModule],
        inject: [TCPConfig],
        useFactory: (tcpConfig: TCPConfig) => {
          return {
            transport: Transport.TCP,
            options: {
              host: tcpConfig.AUTH.HOST,
              port: tcpConfig.AUTH.PORT,
            },
          };
        },
      },
      {
        name: CONFIG_CLIENT,
        imports: [ConfigurationModule],
        inject: [TCPConfig],
        useFactory: (tcpConfig: TCPConfig) => {
          return {
            transport: Transport.TCP,
            options: {
              host: tcpConfig.CONFIG.HOST,
              port: tcpConfig.CONFIG.PORT,
            },
          };
        },
      },
      {
        name: TRANSACTION_CLIENT,
        imports: [ConfigurationModule],
        inject: [TCPConfig],
        useFactory: (tcpConfig: TCPConfig) => {
          return {
            transport: Transport.TCP,
            options: {
              host: tcpConfig.TRANSACTION.HOST,
              port: tcpConfig.TRANSACTION.PORT,
            },
          };
        },
      },
    ]),
  ],
})
export class MicroserviceModule {}
