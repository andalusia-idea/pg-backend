import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import {
  PRISMA_MASTER_AUTH_PROVIDER_KEY,
  PRISMA_SLAVE_AUTH_PROVIDER_KEY,
  PRISMA_MASTER_CONFIG_PROVIDER_KEY,
  PRISMA_SLAVE_CONFIG_PROVIDER_KEY,
  PRISMA_MASTER_TRANSACTION_PROVIDER_KEY,
  PRISMA_SLAVE_TRANSACTION_PROVIDER_KEY,
} from '../database';
import { PrismaClient as PrismaClientAuth } from '@auth/prisma';
import { PrismaClient as PrismaClientConfig } from '@config/prisma';
import { PrismaClient as PrismaClientTransaction } from '@transaction/prisma';
import { RedisHealthIndicator } from '@app/redis';

/** How long a pool gets to answer before it counts as down. */
const PING_TIMEOUT_MS = 1000;

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly prismaHealth: PrismaHealthIndicator,
    @Inject(PRISMA_MASTER_AUTH_PROVIDER_KEY)
    private readonly prismaMasterAuth: PrismaClientAuth,
    @Inject(PRISMA_SLAVE_AUTH_PROVIDER_KEY)
    private readonly prismaSlaveAuth: PrismaClientAuth,
    @Inject(PRISMA_MASTER_CONFIG_PROVIDER_KEY)
    private readonly prismaMasterConfig: PrismaClientConfig,
    @Inject(PRISMA_SLAVE_CONFIG_PROVIDER_KEY)
    private readonly prismaSlaveConfig: PrismaClientConfig,
    @Inject(PRISMA_MASTER_TRANSACTION_PROVIDER_KEY)
    private readonly prismaMasterTransaction: PrismaClientTransaction,
    @Inject(PRISMA_SLAVE_TRANSACTION_PROVIDER_KEY)
    private readonly prismaSlaveTransaction: PrismaClientTransaction,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.redisHealth.pingCheck('redis', PING_TIMEOUT_MS),
      () =>
        this.prismaHealth.pingCheck(
          'prisma-auth-master',
          this.prismaMasterAuth,
          { timeout: PING_TIMEOUT_MS },
        ),
      () =>
        this.prismaHealth.pingCheck('prisma-auth-slave', this.prismaSlaveAuth, {
          timeout: PING_TIMEOUT_MS,
        }),
      () =>
        this.prismaHealth.pingCheck(
          'prisma-config-master',
          this.prismaMasterConfig,
          { timeout: PING_TIMEOUT_MS },
        ),
      () =>
        this.prismaHealth.pingCheck(
          'prisma-config-slave',
          this.prismaSlaveConfig,
          { timeout: PING_TIMEOUT_MS },
        ),
      () =>
        this.prismaHealth.pingCheck(
          'prisma-transaction-master',
          this.prismaMasterTransaction,
          { timeout: PING_TIMEOUT_MS },
        ),
      () =>
        this.prismaHealth.pingCheck(
          'prisma-transaction-slave',
          this.prismaSlaveTransaction,
          { timeout: PING_TIMEOUT_MS },
        ),
    ]);
  }
}
