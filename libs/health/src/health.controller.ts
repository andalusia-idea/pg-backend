import { TCPConfig } from '@app/configuration';
import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { Controller, Get, Inject } from '@nestjs/common';
import { TcpClientOptions, Transport } from '@nestjs/microservices';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MicroserviceHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';

/**
 * Matches what PrismaHealthIndicator.pingCheck() actually expects for a
 * SQL datasource - $queryRawUnsafe (plain string), not the $queryRaw tagged
 * template. Kept minimal on purpose: health checks don't need the full
 * generated PrismaClient type, and this shape is identical across every
 * app's generated client regardless of its models.
 */
interface PingablePrismaClient {
  $queryRawUnsafe: (query: string) => Promise<unknown>;
}

/**
 * **Only things this process genuinely needs.** An earlier version also pinged
 * `https://docs.nestjs.com`, which made every app's liveness probe depend on a
 * third-party site being reachable from the pod - so a DNS hiccup or blocked
 * egress got a healthy process restarted by Kubernetes. A probe that fails for
 * reasons outside the process it is probing is worse than no probe.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly tcpConfig: TCPConfig,
    private readonly health: HealthCheckService,
    private readonly microservice: MicroserviceHealthIndicator,
    private readonly prismaHealth: PrismaHealthIndicator,
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PingablePrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PingablePrismaClient,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => {
        return this.microservice.pingCheck<TcpClientOptions>('tcp-auth', {
          transport: Transport.TCP,
          options: {
            host: this.tcpConfig.AUTH.HOST,
            port: this.tcpConfig.AUTH.PORT,
          },
        });
      },
      () => {
        return this.microservice.pingCheck<TcpClientOptions>('tcp-config', {
          transport: Transport.TCP,
          options: {
            host: this.tcpConfig.CONFIG.HOST,
            port: this.tcpConfig.CONFIG.PORT,
          },
        });
      },
      () => {
        return this.microservice.pingCheck<TcpClientOptions>(
          'tcp-transaction',
          {
            transport: Transport.TCP,
            options: {
              host: this.tcpConfig.TRANSACTION.HOST,
              port: this.tcpConfig.TRANSACTION.PORT,
            },
          },
        );
      },
      () => {
        return this.prismaHealth.pingCheck('prisma-master', this.prismaMaster, {
          timeout: 1000,
        });
      },
      () => {
        return this.prismaHealth.pingCheck('prisma-slave', this.prismaSlave, {
          timeout: 1000,
        });
      },
    ]);
  }
}
