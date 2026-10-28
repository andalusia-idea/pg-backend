import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import Redis from 'ioredis';
import { ProviderNameEnum } from '@app/microservice';
import { TOKEN_KEY, TOKEN_LOCK_KEY } from './redis.constant';
import { REDIS_KEY } from './redis.provider';

/**
 * Which product's token, within one provider.
 *
 * MotionPay is one provider with three products, each with its own host, token
 * endpoint and credentials - so one token per provider would be wrong. A typed
 * union rather than a free string because a typo would silently mint a second
 * namespace and quietly defeat the sharing this whole class exists for.
 */
export const TokenContext = {
  ALL: 'all',
  QRIS: 'qris',
  TRANSFER: 'transfer',
  BILLER: 'biller',
} as const;
export type TokenContext = (typeof TokenContext)[keyof typeof TokenContext];

export interface UpstreamToken {
  token: string;
  /** Epoch seconds after which the token must not be reused. */
  expiresAtSeconds: number;
}

/** What actually sits in Redis. */
type TokenEntry = { token: string; expiresAtSeconds: number };

/**
 * How long one pod may hold the right to refresh.
 *
 * Must outlast a token fetch or the lock expires mid-flight and a second pod
 * starts its own - the exact thing this prevents. Comfortably above the 15s
 * default upstream timeout.
 */
const LOCK_TTL_MS = 20_000;

/** How long a pod that lost the race waits for the winner to publish. */
const LOCK_WAIT_INTERVAL_MS = 150;
const LOCK_WAIT_ATTEMPTS = 20;

/**
 * One upstream token per provider-product, shared across replicas.
 *
 * **Why this is not simply a cache.** A per-pod token is fine when an upstream
 * issues independent tokens - two pods each hold their own and never interact.
 * It stops being fine the moment issuing a token *revokes* the previous one, or
 * the provider caps concurrent sessions: pod A refreshes and kills pod B's
 * token, B gets a 401 and refreshes, killing A's, and the two never converge.
 * The symptom is a refresh storm that only appears above one replica, and each
 * lap costs a 401 plus a token call on a live payment request.
 *
 * So the token is shared state, and the two things that make shared state work
 * are both here: a **lock**, so only one pod refreshes at a time, and
 * **compare-and-refresh** on 401, so a pod that meets a dead token adopts
 * whatever a sibling already published instead of minting another one.
 *
 * Reads fail **open** - a Redis outage degrades this to the per-pod behaviour
 * we had before, which is slower and racier but still works. Writes and
 * invalidations are best-effort for the same reason. Contrast the nonce and
 * rate-limit paths in `MerchantSignatureRedis`, which are security controls and
 * deliberately fail closed.
 *
 * > This stores a live bearer credential at rest in Redis, in plaintext, next
 * > to the merchant HMAC secrets that are already there. That is a known open
 * > item, and adding to it is a deliberate trade for the coordination above -
 * > not an oversight. Encrypt both together when that item is addressed.
 */
@Injectable()
export class TokenRedis {
  private readonly logger = new Logger(TokenRedis.name);

  constructor(
    @Inject(REDIS_KEY)
    private readonly redis: Redis,
  ) {}

  private tokenKey(providerName: ProviderNameEnum, context: TokenContext) {
    return `${TOKEN_KEY}:${providerName}:${context}`;
  }

  private lockKey(providerName: ProviderNameEnum, context: TokenContext) {
    return `${TOKEN_LOCK_KEY}:${providerName}:${context}`;
  }

  /**
   * Return a usable token, refreshing through the lock if there is not one.
   *
   * `refresh` is the caller's own token call - this class stays ignorant of
   * envelopes, credentials and JWT decoding, and only owns the coordination.
   */
  async getOrRefresh(params: {
    providerName: ProviderNameEnum;
    context: TokenContext;
    refresh: () => Promise<UpstreamToken>;
  }): Promise<UpstreamToken> {
    const cached = await this.read(params.providerName, params.context);
    if (cached) return cached;

    return this.refreshUnderLock(params);
  }

  /**
   * Handle a 401 without starting a storm.
   *
   * The token that just failed is passed in, and if Redis now holds a
   * *different* one a sibling has already refreshed - so adopt theirs rather
   * than minting another and revoking it. Only when the stored token is the
   * same dead value do we invalidate and refresh.
   *
   * That check is what stops two pods taking turns killing each other's
   * credentials.
   */
  async refreshIfUnchanged(params: {
    providerName: ProviderNameEnum;
    context: TokenContext;
    staleToken: string;
    refresh: () => Promise<UpstreamToken>;
  }): Promise<UpstreamToken> {
    const current = await this.read(params.providerName, params.context);
    if (current && current.token !== params.staleToken) return current;

    await this.delete(params.providerName, params.context);
    return this.refreshUnderLock(params);
  }

  /** Read the shared token, or null to mean "there isn't a usable one". */
  private async read(
    providerName: ProviderNameEnum,
    context: TokenContext,
  ): Promise<UpstreamToken | null> {
    const key = this.tokenKey(providerName, context);

    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (error) {
      this.logger.warn({ msg: `${key} read failed`, error });
      return null;
    }
    if (!raw) return null;

    let entry: TokenEntry;
    try {
      entry = JSON.parse(raw) as TokenEntry;
    } catch (error) {
      this.logger.warn({ msg: `${key} entry unreadable`, error });
      return null;
    }

    // The key's TTL should have removed it already; treat a survivor as a miss
    // rather than handing back a token that is about to be refused.
    if (entry.expiresAtSeconds <= this.nowSeconds()) return null;

    return entry;
  }

  /**
   * Publish a token, expiring the key exactly when the token does.
   *
   * The TTL is the point - it is what stops a dead credential outliving the
   * process that wrote it. A token already at or past its expiry is dropped
   * rather than written, since a zero or negative TTL is an error in Redis and
   * a key with no expiry is worse than no key at all.
   */
  private async write(
    providerName: ProviderNameEnum,
    context: TokenContext,
    value: UpstreamToken,
  ): Promise<void> {
    const key = this.tokenKey(providerName, context);
    const ttlSeconds = value.expiresAtSeconds - this.nowSeconds();
    if (ttlSeconds < 1) return;

    const entry: TokenEntry = {
      token: value.token,
      expiresAtSeconds: value.expiresAtSeconds,
    };

    try {
      await this.redis.set(key, JSON.stringify(entry), 'EX', ttlSeconds);
    } catch (error) {
      // Swallowed: we still hold a working token and the caller can use it.
      // The cost is that siblings will each fetch their own.
      this.logger.warn({ msg: `${key} write failed`, error });
    }
  }

  /** Drop the shared token. Loud, because a missed invalidation is a storm. */
  private async delete(
    providerName: ProviderNameEnum,
    context: TokenContext,
  ): Promise<void> {
    const key = this.tokenKey(providerName, context);
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error({ msg: `${key} invalidation failed`, error });
    }
  }

  /**
   * Refresh, letting exactly one pod do the work.
   *
   * The loser waits and re-reads rather than queueing behind the lock, because
   * what it actually wants is the *result*, and the winner publishes that to
   * Redis before releasing.
   *
   * If the wait runs out - the winner crashed, or Redis is unreachable - we
   * refresh anyway rather than failing the request. Under a revoking upstream
   * that risks a duplicate refresh, which is survivable precisely because the
   * newest token is always published: the pods reconverge on the next read. A
   * failed payment does not reconverge.
   */
  private async refreshUnderLock(params: {
    providerName: ProviderNameEnum;
    context: TokenContext;
    refresh: () => Promise<UpstreamToken>;
  }): Promise<UpstreamToken> {
    const { providerName, context, refresh } = params;
    const holder = await this.acquireLock(providerName, context);

    if (!holder) {
      const published = await this.waitForToken(providerName, context);
      if (published) return published;

      this.logger.warn({
        msg: 'Token refresh lock held but nothing was published; refreshing anyway',
        providerName,
        context,
      });
      const minted = await refresh();
      await this.write(providerName, context, minted);
      return minted;
    }

    try {
      // Re-read inside the lock: we may have queued behind a winner that
      // published and released while we were acquiring.
      const current = await this.read(providerName, context);
      if (current) return current;

      const minted = await refresh();
      await this.write(providerName, context, minted);
      return minted;
    } finally {
      await this.releaseLock(providerName, context, holder);
    }
  }

  /** Returns an ownership token, or null if another pod is already refreshing. */
  private async acquireLock(
    providerName: ProviderNameEnum,
    context: TokenContext,
  ): Promise<string | null> {
    const holder = randomBytes(16).toString('hex');
    try {
      const ok = await this.redis.set(
        this.lockKey(providerName, context),
        holder,
        'PX',
        LOCK_TTL_MS,
        'NX',
      );
      return ok === 'OK' ? holder : null;
    } catch (error) {
      // Redis unreachable: behave as if uncontended. Without a lock we are back
      // to the per-pod behaviour, which is what we had before this class.
      this.logger.warn({ msg: 'Token refresh lock unavailable', error });
      return holder;
    }
  }

  /**
   * Release only if we still hold it.
   *
   * A plain `DEL` would release a lock that had already expired and been taken
   * by someone else - handing a third pod the right to refresh while the second
   * is mid-flight. The compare and delete must be one step, so it is a script.
   */
  private async releaseLock(
    providerName: ProviderNameEnum,
    context: TokenContext,
    holder: string,
  ): Promise<void> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      end
      return 0
    `;
    try {
      await this.redis.eval(
        script,
        1,
        this.lockKey(providerName, context),
        holder,
      );
    } catch (error) {
      // The lock's own TTL is the backstop, so this is a delay, not a deadlock.
      this.logger.warn({ msg: 'Token refresh lock release failed', error });
    }
  }

  /** Poll for the winner's result, up to the bounded wait. */
  private async waitForToken(
    providerName: ProviderNameEnum,
    context: TokenContext,
  ): Promise<UpstreamToken | null> {
    for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt++) {
      await new Promise((resolve) =>
        setTimeout(resolve, LOCK_WAIT_INTERVAL_MS),
      );
      const published = await this.read(providerName, context);
      if (published) return published;
    }
    return null;
  }

  private nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }
}
