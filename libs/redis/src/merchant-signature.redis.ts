import { MerchantSignatureStatusEnum } from '@app/microservice';
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import {
  MERCHANT_SIGNATURE_KEY_PREFIX,
  NONCE_KEY_PREFIX,
} from './redis.constant';
import { REDIS_KEY } from './redis.provider';

export interface MerchantSignatureRedisDto {
  userId: number;
  secretKey: string | null;
  secretKeyPrevious: string | null;
  secretKeyRotatedAt: Date | null;
  status: MerchantSignatureStatusEnum;
}

/** What actually sits in Redis: JSON has no Date, so the instant is epoch ms. */
type MerchantSignatureCacheEntry = Omit<
  MerchantSignatureRedisDto,
  'secretKeyRotatedAt'
> & { secretKeyRotatedAt: number | null };

@Injectable()
export class MerchantSignatureRedis {
  private readonly logger = new Logger(MerchantSignatureRedis.name);

  constructor(
    @Inject(REDIS_KEY)
    private readonly redis: Redis,
  ) {}

  private nonceKey(clientId: string, nonce: string): string {
    return `${NONCE_KEY_PREFIX}:${clientId}:${nonce}`;
  }

  private merchantSignatureKey(clientId: string): string {
    return `${MERCHANT_SIGNATURE_KEY_PREFIX}:${clientId}`;
  }

  /**
   * Claim a nonce for the replay window. Returns true if it had not been seen.
   *
   * `SET NX` tests and sets in one atomic step, which is what makes this
   * correct across replicas - the deployment runs `maxReplicas: 2`, so a
   * read-then-write pair would let a replay routed to the other pod slip
   * through the gap between the two calls.
   *
   * It also must not be a read-and-delete (`GETDEL`): consuming the stored
   * nonce on a *rejected* replay leaves nothing behind, so the very next
   * replay of the same request finds a clean slate and succeeds. The nonce has
   * to survive its full TTL however many times it is presented.
   *
   * Redis failures are deliberately **not** caught here. This is a security
   * control, not an optimisation: answering "not seen" when the store is
   * unreachable fails open, so the caller's fail-closed path must reject
   * instead. Contrast the cache methods below, which fail *open* on purpose.
   */
  async claimNonce(
    clientId: string,
    nonce: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const result = await this.redis.set(
      this.nonceKey(clientId, nonce),
      '1',
      'EX',
      ttlSeconds,
      'NX',
    );
    return result === 'OK';
  }

  /**
   * Cache a merchant's signature row.
   *
   * Only ever called on a cache **miss**. Writing on a hit would refresh the
   * TTL on every request, so a busy merchant's entry would never expire - and
   * expiry is the only safety net if an invalidation is ever missed.
   *
   * Cache failures are swallowed: this is an optimisation, and a Redis outage
   * must not take down verification while the database is healthy.
   */
  async setMerchantSignature(
    clientId: string,
    value: MerchantSignatureRedisDto,
    ttlSeconds: number,
  ): Promise<void> {
    const entry: MerchantSignatureCacheEntry = {
      ...value,
      // JSON has no Date type. Storing epoch milliseconds rather than an ISO
      // string keeps the revive below unambiguous.
      secretKeyRotatedAt: value.secretKeyRotatedAt?.getTime() ?? null,
    };

    try {
      await this.redis.setex(
        this.merchantSignatureKey(clientId),
        ttlSeconds,
        JSON.stringify(entry),
      );
    } catch (error) {
      this.logger.warn({ msg: 'Merchant signature cache write failed', error });
    }
  }

  /**
   * Read a cached merchant signature row, or null to mean "go to the database".
   *
   * Any failure - Redis down, malformed entry - is reported as a miss. A cache
   * that cannot answer should slow the request down, not fail it.
   */
  async getMerchantSignature(
    clientId: string,
  ): Promise<MerchantSignatureRedisDto | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(this.merchantSignatureKey(clientId));
    } catch (error) {
      this.logger.warn({ msg: 'Merchant signature cache read failed', error });
      return null;
    }

    if (!raw) return null;

    try {
      const entry = JSON.parse(raw) as MerchantSignatureCacheEntry;
      return {
        ...entry,
        // Without this the field comes back as a number and every caller doing
        // `.getTime()` or `.toISOString()` on it throws - which is exactly the
        // rotation-grace path.
        secretKeyRotatedAt:
          entry.secretKeyRotatedAt === null
            ? null
            : new Date(entry.secretKeyRotatedAt),
      };
    } catch (error) {
      this.logger.warn({
        msg: 'Merchant signature cache entry unreadable',
        error,
      });
      return null;
    }
  }

  /**
   * Drop a merchant's cached row.
   *
   * **Must be called on every write to `MerchantSignature`** - key rotation and
   * status changes above all. Without it a rotation is invisible for the whole
   * TTL: the cache still holds the pre-rotation row, so a merchant signing with
   * their new secret matches neither `secretKey` nor `secretKeyPrevious` and is
   * rejected as INVALID_SIGNATURE. A suspension is equally invisible - suspended
   * credentials keep working until the entry expires.
   */
  async deleteMerchantSignature(clientId: string): Promise<void> {
    try {
      await this.redis.del(this.merchantSignatureKey(clientId));
    } catch (error) {
      // Logged loudly: a failed invalidation means stale credentials stay live
      // until the TTL closes the window.
      this.logger.error({
        msg: 'Merchant signature cache invalidation failed',
        clientId,
        error,
      });
    }
  }
}
