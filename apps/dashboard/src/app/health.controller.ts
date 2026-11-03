import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { RedisHealthIndicator } from '@app/redis';
import { Controller, Get, Inject } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { SkipResponseInterceptor } from '../shared/interceptor';

/** How long a pool gets to answer before it counts as down. */
const PING_TIMEOUT_MS = 1000;

/**
 * What `PrismaHealthIndicator.pingCheck()` actually needs from a SQL
 * datasource. Deliberately not the generated `PrismaClient`: the master
 * provider hands back a `$extends`-ed client carrying the audit extension,
 * whose type is not the type of the client it was built from.
 */
interface PingablePrismaClient {
  $queryRawUnsafe: (query: string) => Promise<unknown>;
}

/**
 * Liveness for the dashboard.
 *
 * Local rather than `@app/health`, because that controller also pings
 * `tcp-auth`, `tcp-config` and `tcp-transaction` through `TCPConfig` - and the
 * dashboard holds no TCP client to any of them. Since the merged-schema move
 * it reads all three schemas from Postgres directly, and no dashboard env file
 * has ever defined a `CLIENT_*` key, so `TCPConfig.AUTH` threw a plain `Error`
 * out of `getOrThrow` on every request. Terminus rethrows anything that is not
 * a `HealthCheckError`, so the probe answered **500** rather than the 503 a
 * failed check gives, and `AllExceptionsFilter` logs nothing - the 401 the
 * route used to return had been hiding all of it.
 *
 * Supplying the nine `CLIENT_*` keys would have been the worse fix: it makes
 * this process's liveness depend on three services it never calls, which is
 * the failure mode `@app/health`'s own doc block warns against.
 *
 * Served at `/health`, not `/api/v1/health`: `main.ts` excludes it from the
 * global prefix so the path matches the apps that set no prefix, and
 * `JwtAuthGuard` lets that one path through unauthenticated. The ResponseDto
 * envelope is skipped too, so one monitoring check reads the same
 * HealthCheckResult from all six apps instead of a shape only this app's
 * frontend understands.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly prismaHealth: PrismaHealthIndicator,
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PingablePrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PingablePrismaClient,
  ) {}

  @Get()
  @HealthCheck()
  @SkipResponseInterceptor()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.redisHealth.pingCheck('redis', PING_TIMEOUT_MS),

      () =>
        this.prismaHealth.pingCheck('prisma-master', this.prismaMaster, {
          timeout: PING_TIMEOUT_MS,
        }),
      () =>
        this.prismaHealth.pingCheck('prisma-slave', this.prismaSlave, {
          timeout: PING_TIMEOUT_MS,
        }),
    ]);
  }
}
