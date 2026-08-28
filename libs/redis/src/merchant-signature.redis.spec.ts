import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MerchantSignatureStatusEnum } from '@app/microservice';
import {
  MerchantSignatureRedis,
  MerchantSignatureRedisDto,
} from './merchant-signature.redis';

const CLIENT_ID = '3f2b8c1d-4e5a-4b6c-8d9e-0a1b2c3d4e5f';
const NONCE = 'b7c1e2d3-4f5a-4b6c-8d9e-0a1b2c3d4e5f';

const NONCE_TTL_SECONDS = 600;
const CACHE_TTL_SECONDS = 60;

const NONCE_KEY = `merchant-signature:nonce:${CLIENT_ID}:${NONCE}`;
const CACHE_KEY = `merchant-signature:db:${CLIENT_ID}`;

const row = (
  overrides: Partial<MerchantSignatureRedisDto> = {},
): MerchantSignatureRedisDto => ({
  userId: 42,
  secretKey: 'a'.repeat(64),
  secretKeyPrevious: null,
  secretKeyRotatedAt: null,
  status: MerchantSignatureStatusEnum.ACTIVE,
  allowedIps: [],
  ...overrides,
});

describe('MerchantSignatureRedis', () => {
  let set: jest.Mock;
  let setex: jest.Mock;
  let get: jest.Mock;
  let del: jest.Mock;
  let redis: MerchantSignatureRedis;

  beforeEach(() => {
    set = jest.fn(async () => 'OK');
    setex = jest.fn(async () => 'OK');
    get = jest.fn(async () => null);
    del = jest.fn(async () => 1);

    redis = new MerchantSignatureRedis(
      { set, setex, get, del } as never,
      {
        NONCE_TTL_SECONDS,
        CACHE_TTL_SECONDS,
      } as never,
    );
  });

  describe('claimNonce', () => {
    /**
     * `SET NX` tests and sets atomically. A read-then-write pair would let a
     * replay routed to the other pod slip through the gap - the deployment
     * runs two replicas.
     *
     * It must also not be `GETDEL`: consuming the stored nonce on a rejected
     * replay leaves nothing behind, so the very next replay of the same
     * request finds a clean slate and succeeds.
     */
    it('claims atomically with NX and the nonce TTL', async () => {
      await redis.claimNonce(CLIENT_ID, NONCE);

      expect(set).toHaveBeenCalledWith(
        NONCE_KEY,
        '1',
        'EX',
        NONCE_TTL_SECONDS,
        'NX',
      );
    });

    /**
     * The TTL that matters here is the *nonce* one, not the cache one. They
     * differ by an order of magnitude, and the nonce TTL is the value
     * constrained to outlast the timestamp tolerance - swapping them would
     * open a replay window with nothing else to catch it.
     */
    it('does not use the cache TTL', async () => {
      await redis.claimNonce(CLIENT_ID, NONCE);

      const [, , , ttl] = set.mock.calls[0] as [string, string, string, number];
      expect(ttl).toBe(NONCE_TTL_SECONDS);
      expect(ttl).not.toBe(CACHE_TTL_SECONDS);
    });

    it('reports true only when the key was newly set', async () => {
      await expect(redis.claimNonce(CLIENT_ID, NONCE)).resolves.toBe(true);

      set.mockResolvedValue(null as never); // NX found an existing key
      await expect(redis.claimNonce(CLIENT_ID, NONCE)).resolves.toBe(false);
    });

    /**
     * Fails **closed**, unlike the cache methods. Answering "not seen" when the
     * store is unreachable would wave replays through, so the error must reach
     * the caller's fail-closed path.
     */
    it('propagates a Redis failure instead of swallowing it', async () => {
      set.mockRejectedValue(new Error('redis unreachable') as never);

      await expect(redis.claimNonce(CLIENT_ID, NONCE)).rejects.toThrow(
        'redis unreachable',
      );
    });
  });

  describe('setMerchantSignature', () => {
    it('writes under the cache TTL, not the nonce TTL', async () => {
      await redis.setMerchantSignature(CLIENT_ID, row());

      const [key, ttl] = setex.mock.calls[0] as [string, number, string];
      expect(key).toBe(CACHE_KEY);
      expect(ttl).toBe(CACHE_TTL_SECONDS);
      expect(ttl).not.toBe(NONCE_TTL_SECONDS);
    });

    /** JSON has no Date type, so the instant is stored as epoch milliseconds. */
    it('serialises the rotation timestamp as epoch milliseconds', async () => {
      const rotatedAt = new Date('2026-08-27T10:15:30.000Z');
      await redis.setMerchantSignature(
        CLIENT_ID,
        row({ secretKeyRotatedAt: rotatedAt }),
      );

      const [, , raw] = setex.mock.calls[0] as [string, number, string];
      expect(JSON.parse(raw)).toMatchObject({
        secretKeyRotatedAt: rotatedAt.getTime(),
      });
    });

    /** A cache is an optimisation: an outage must not fail the request. */
    it('swallows a Redis failure', async () => {
      setex.mockRejectedValue(new Error('redis unreachable') as never);

      await expect(
        redis.setMerchantSignature(CLIENT_ID, row()),
      ).resolves.toBeUndefined();
    });
  });

  describe('getMerchantSignature', () => {
    it('returns null on a miss', async () => {
      await expect(redis.getMerchantSignature(CLIENT_ID)).resolves.toBeNull();
      expect(get).toHaveBeenCalledWith(CACHE_KEY);
    });

    /**
     * The revive that makes the rotation grace window work. Without it the
     * field comes back as a number and `isWithinGraceWindow` throws on
     * `.getTime()` - a 503 on the one path hardest to notice missing.
     */
    it('revives the rotation timestamp as a Date', async () => {
      const rotatedAt = new Date('2026-08-27T10:15:30.000Z');
      await redis.setMerchantSignature(
        CLIENT_ID,
        row({ secretKeyRotatedAt: rotatedAt }),
      );
      const [, , raw] = setex.mock.calls[0] as [string, number, string];
      get.mockResolvedValue(raw as never);

      const cached = await redis.getMerchantSignature(CLIENT_ID);

      expect(cached?.secretKeyRotatedAt).toBeInstanceOf(Date);
      expect(cached?.secretKeyRotatedAt?.getTime()).toBe(rotatedAt.getTime());
    });

    it('round-trips a row unchanged', async () => {
      const original = row({
        secretKeyPrevious: 'b'.repeat(64),
        secretKeyRotatedAt: new Date('2026-08-27T10:15:30.000Z'),
        allowedIps: ['203.0.113.5', '198.51.100.0/24'],
      });
      await redis.setMerchantSignature(CLIENT_ID, original);
      const [, , raw] = setex.mock.calls[0] as [string, number, string];
      get.mockResolvedValue(raw as never);

      await expect(redis.getMerchantSignature(CLIENT_ID)).resolves.toEqual(
        original,
      );
    });

    /** Fails **open**: a cache that cannot answer should slow the request
     * down, not fail it. */
    it('reports a Redis failure as a miss', async () => {
      get.mockRejectedValue(new Error('redis unreachable') as never);

      await expect(redis.getMerchantSignature(CLIENT_ID)).resolves.toBeNull();
    });

    it('reports an unparseable entry as a miss', async () => {
      get.mockResolvedValue('{not json' as never);

      await expect(redis.getMerchantSignature(CLIENT_ID)).resolves.toBeNull();
    });
  });

  describe('deleteMerchantSignature', () => {
    it('drops the cache key', async () => {
      await redis.deleteMerchantSignature(CLIENT_ID);

      expect(del).toHaveBeenCalledWith(CACHE_KEY);
    });

    /**
     * A failed invalidation leaves stale credentials live until the TTL
     * closes the window, so it must not take the caller's write down with it -
     * the rotation itself already committed.
     */
    it('swallows a Redis failure', async () => {
      del.mockRejectedValue(new Error('redis unreachable') as never);

      await expect(
        redis.deleteMerchantSignature(CLIENT_ID),
      ).resolves.toBeUndefined();
    });
  });

  /** Namespaced so `SCAN merchant-signature:*` stays usable for debugging. */
  it('keys nonces and cache entries in separate namespaces', async () => {
    await redis.claimNonce(CLIENT_ID, NONCE);
    await redis.setMerchantSignature(CLIENT_ID, row());

    const [nonceKey] = set.mock.calls[0] as [string];
    const [cacheKey] = setex.mock.calls[0] as [string];

    expect(nonceKey).not.toBe(cacheKey);
    expect(nonceKey.startsWith('merchant-signature:nonce:')).toBe(true);
    expect(cacheKey.startsWith('merchant-signature:db:')).toBe(true);
  });
});
