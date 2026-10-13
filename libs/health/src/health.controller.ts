import { TCPConfig } from '@app/configuration';
import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { RedisHealthIndicator } from '@app/redis';
import { Controller, Get, Inject } from '@nestjs/common';
import { TcpClientOptions, Transport } from '@nestjs/microservices';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  MicroserviceHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';

/** How long a pool gets to answer before it counts as down. */
const PING_TIMEOUT_MS = 1000;

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
    private readonly health: HealthCheckService,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly tcpConfig: TCPConfig,
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
      () => this.redisHealth.pingCheck('redis', PING_TIMEOUT_MS),

      () => {
        return this.microservice.pingCheck<TcpClientOptions>('tcp-auth', {
          transport: Transport.TCP,
          options: {
            host: this.tcpConfig.AUTH.HOST,
            port: this.tcpConfig.AUTH.PORT,
          },
          timeout: PING_TIMEOUT_MS,
        });
      },
      () => {
        return this.microservice.pingCheck<TcpClientOptions>('tcp-config', {
          transport: Transport.TCP,
          options: {
            host: this.tcpConfig.CONFIG.HOST,
            port: this.tcpConfig.CONFIG.PORT,
          },
          timeout: PING_TIMEOUT_MS,
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
            timeout: PING_TIMEOUT_MS,
          },
        );
      },

      () => {
        return this.prismaHealth.pingCheck('prisma-master', this.prismaMaster, {
          timeout: PING_TIMEOUT_MS,
        });
      },
      () => {
        return this.prismaHealth.pingCheck('prisma-slave', this.prismaSlave, {
          timeout: PING_TIMEOUT_MS,
        });
      },
    ]);
  }
}
