import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_KEY } from './redis.provider';

/**
 * Short on purpose: a probe that hangs is a probe that fails.
 *
 * `ioredis` queues commands while disconnected (`enableOfflineQueue` defaults
 * to true), so a `ping()` against a dead Redis does not reject promptly - it
 * waits out `maxRetriesPerRequest`, which `RedisClient` sets to 3 with a
 * backoff `retryStrategy`. That is longer than a liveness probe should wait, so
 * the race below is load-bearing rather than belt-and-braces.
 */
const PING_TIMEOUT_MS = 1000;

/**
 * Reports whether this process can still reach Redis.
 *
 * Lives in `libs/redis` because that is what already owns the client, the
 * config and the module - an indicator over its own connection belongs beside
 * them. It was briefly inlined into two health controllers, which meant two
 * copies of a timeout race on a liveness path: the kind of duplication that
 * drifts the moment one of the two timeouts is tuned.
 *
 * No third-party package, deliberately. `@liaoliaots/nestjs-redis-health` wants
 * NestJS 9 and was last published in January 2023; `@nestjs-labs/nestjs-redis-health`
 * wants NestJS 12. This repo is on 11, so both would need `--legacy-peer-deps`
 * - a poor trade for one `ping()`, when `@nestjs/terminus` 11 already exports
 * `HealthIndicatorService` for exactly this.
 *
 * ---
 * **What this can and cannot catch.** `RedisClient.onModuleInit` awaits a ping
 * at startup, so a process whose Redis was never reachable crashes rather than
 * booting unhealthy - Kubernetes sees CrashLoopBackOff, not a failing probe, and
 * this indicator never gets to answer. What it does catch is Redis dying *after*
 * boot, which is the case a probe is actually for.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(REDIS_KEY)
    private readonly redis: Redis,
  ) {}

  async pingCheck(
    key = 'redis',
    timeoutMs: number = PING_TIMEOUT_MS,
  ): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    // Cleared in `finally`: when the ping wins, an uncleared timer stays
    // pending for the full timeout and can add that much to a graceful
    // shutdown. Promise.race attaches handlers to both, so the loser rejecting
    // is handled rather than an unhandled rejection - but the handle lingers.
    let timer: NodeJS.Timeout | undefined;

    try {
      // No `=== 'PONG'` check: ioredis types `ping()` as returning the literal
      // 'PONG', so the other branch is unreachable and narrows to `never`. If
      // it resolves at all, Redis answered - a different reply would be a
      // protocol violation, not a health state worth modelling.
      await Promise.race([
        this.redis.ping(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`ping exceeded ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);

      return indicator.up();
    } catch (error) {
      return indicator.down(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
