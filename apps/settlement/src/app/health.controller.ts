import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import {
  PRISMA_MASTER_TRANSACTION_PROVIDER_KEY,
  PRISMA_SLAVE_TRANSACTION_PROVIDER_KEY,
} from '../database';
import { PrismaClient as PrismaClientTransaction } from '@transaction/prisma';
import { RedisHealthIndicator } from '@app/redis';

/** How long a pool gets to answer before it counts as down. */
const PING_TIMEOUT_MS = 1000;

/**
 * Liveness for the settlement worker.
 *
 * Local rather than `@app/health`, because that controller injects
 * `PRISMA_MASTER_PROVIDER_KEY` / `PRISMA_SLAVE_PROVIDER_KEY` - tokens only
 * `PrismaModule.forRoot` provides - and this app has a client per schema
 * instead of one per app. Pinging the transaction pools by their own tokens is
 * a smaller change than teaching a lib four apps share about a second naming
 * scheme.
 *
 * **Database reachability only.** `@app/health` also pings
 * `https://docs.nestjs.com`, which is deliberately not copied here: it makes
 * the liveness probe depend on a third-party site being reachable from the pod,
 * so a DNS hiccup or blocked egress gets a healthy process restarted. That
 * costs more for this app than for an API - a restart can kill a settlement
 * batch mid-transaction, manufacturing exactly the stuck run the Step 11
 * sweeper exists to clean up.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly prismaHealth: PrismaHealthIndicator,
    @Inject(PRISMA_MASTER_TRANSACTION_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClientTransaction,
    @Inject(PRISMA_SLAVE_TRANSACTION_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClientTransaction,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.redisHealth.pingCheck('redis', PING_TIMEOUT_MS),

      () =>
        this.prismaHealth.pingCheck(
          'prisma-transaction-master',
          this.prismaMaster,
          { timeout: PING_TIMEOUT_MS },
        ),
      () =>
        this.prismaHealth.pingCheck(
          'prisma-transaction-slave',
          this.prismaSlave,
          { timeout: PING_TIMEOUT_MS },
        ),
    ]);
  }
}
