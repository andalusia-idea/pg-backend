import { Global, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigurationModule, TCPConfig } from '@app/configuration';
import { AUTH_CLIENT, CONFIG_CLIENT } from './constants/tcp-clients.constant';
import { UserAuthClient } from './clients/user-auth.client';
import { MerchantSignatureAuthClient } from './clients/merchant-signature-auth.client';
import { AgentConfigClient } from './clients/agent-config.client';
import { MerchantConfigClient } from './clients/merchant-config.client';
import { FeeCalculateConfigClient } from './clients/fee-calculate-config.client';
import { ProfileProviderConfigClient } from './clients/profile-provider-config.client';

/**
 * TCP connections to Auth and Config only. Nothing in the current scope
 * (Auth/Config/Transaction) calls Transaction as a peer.
 */
@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: AUTH_CLIENT,
        imports: [ConfigurationModule],
        inject: [TCPConfig],
        useFactory: (tcpConfig: TCPConfig) => ({
          transport: Transport.TCP,
          options: {
            host: tcpConfig.AUTH.HOST,
            port: tcpConfig.AUTH.PORT,
          },
        }),
      },
      {
        name: CONFIG_CLIENT,
        imports: [ConfigurationModule],
        inject: [TCPConfig],
        useFactory: (tcpConfig: TCPConfig) => ({
          transport: Transport.TCP,
          options: {
            host: tcpConfig.CONFIG.HOST,
            port: tcpConfig.CONFIG.PORT,
          },
        }),
      },
    ]),
  ],
  providers: [
    UserAuthClient,
    MerchantSignatureAuthClient,
    AgentConfigClient,
    MerchantConfigClient,
    FeeCalculateConfigClient,
    ProfileProviderConfigClient,
  ],
  exports: [
    UserAuthClient,
    MerchantSignatureAuthClient,
    AgentConfigClient,
    MerchantConfigClient,
    FeeCalculateConfigClient,
    ProfileProviderConfigClient,
  ],
})
export class MicroserviceClientsModule {}
