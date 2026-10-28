import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ProviderNameEnum } from '@app/microservice';
import { TokenContext, TokenRedis, UpstreamToken } from './token.redis';

const PROVIDER = ProviderNameEnum.MOTIONPAY;
const CONTEXT = TokenContext.QRIS;
const TOKEN_KEY = `token:${PROVIDER}:${CONTEXT}`;
const LOCK_KEY = `token:lock:${PROVIDER}:${CONTEXT}`;

const nowSeconds = () => Math.floor(Date.now() / 1000);

const entry = (token: string, ttlSeconds = 3600) =>
  JSON.stringify({ token, expiresAtSeconds: nowSeconds() + ttlSeconds });

const minted = (token: string, ttlSeconds = 3600): UpstreamToken => ({
  token,
  expiresAtSeconds: nowSeconds() + ttlSeconds,
});

describe('TokenRedis', () => {
  let get: jest.Mock;
  let set: jest.Mock;
  let del: jest.Mock;
  let evalScript: jest.Mock;
  let tokenRedis: TokenRedis;

  beforeEach(() => {
    get = jest.fn(async () => null);
    set = jest.fn(async () => 'OK');
    del = jest.fn(async () => 1);
    evalScript = jest.fn(async () => 1);

    tokenRedis = new TokenRedis({
      get,
      set,
      del,
      eval: evalScript,
    } as never);
  });

  describe('getOrRefresh', () => {
    it('returns the shared token without minting when one is published', async () => {
      get.mockImplementation(async (key: string) =>
        key === TOKEN_KEY ? entry('shared') : null,
      );
      const refresh = jest.fn(async () => minted('fresh'));

      const result = await tokenRedis.getOrRefresh({
        providerName: PROVIDER,
        context: CONTEXT,
        refresh,
      });

      expect(result.token).toBe('shared');
      expect(refresh).not.toHaveBeenCalled();
    });

    it('mints and publishes with a TTL when nothing is shared', async () => {
      const refresh = jest.fn(async () => minted('fresh', 600));

      const result = await tokenRedis.getOrRefresh({
        providerName: PROVIDER,
        context: CONTEXT,
        refresh,
      });

      expect(result.token).toBe('fresh');

      const write = set.mock.calls.find(([key]) => key === TOKEN_KEY);
      expect(write).toBeDefined();
      // The TTL is the whole point: without it a dead credential outlives the
      // process that wrote it.
      const [, , mode, ttl] = write as [string, string, string, number];
      expect(mode).toBe('EX');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    });

    it('takes the lock before minting, and releases it', async () => {
      await tokenRedis.getOrRefresh({
        providerName: PROVIDER,
        context: CONTEXT,
        refresh: async () => minted('fresh'),
      });

      const lock = set.mock.calls.find(([key]) => key === LOCK_KEY);
      expect(lock).toBeDefined();
      expect(lock).toEqual([LOCK_KEY, expect.any(String), 'PX', 20_000, 'NX']);

      // Compare-and-delete, never a bare DEL - a plain delete would release a
      // lock that had already expired into someone else's hands.
      expect(evalScript).toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });

    it('does not mint if the winner published while we were acquiring', async () => {
      // Nothing on the first read, something by the time we hold the lock.
      let reads = 0;
      get.mockImplementation(async (key: string) => {
        if (key !== TOKEN_KEY) return null;
        reads += 1;
        return reads === 1 ? null : entry('published-by-winner');
      });
      const refresh = jest.fn(async () => minted('ours'));

      const result = await tokenRedis.getOrRefresh({
        providerName: PROVIDER,
        context: CONTEXT,
        refresh,
      });

      expect(result.token).toBe('published-by-winner');
      expect(refresh).not.toHaveBeenCalled();
    });

    it('treats an expired entry as a miss', async () => {
      get.mockImplementation(async (key: string) =>
        key === TOKEN_KEY
          ? JSON.stringify({
              token: 'stale',
              expiresAtSeconds: nowSeconds() - 1,
            })
          : null,
      );
      const refresh = jest.fn(async () => minted('fresh'));

      const result = await tokenRedis.getOrRefresh({
        providerName: PROVIDER,
        context: CONTEXT,
        refresh,
      });

      expect(result.token).toBe('fresh');
      expect(refresh).toHaveBeenCalled();
    });

    it('falls back to minting when Redis is unreachable', async () => {
      get.mockImplementation(async () => {
        throw new Error('ECONNREFUSED');
      });
      set.mockImplementation(async () => {
        throw new Error('ECONNREFUSED');
      });
      const refresh = jest.fn(async () => minted('fresh'));

      const result = await tokenRedis.getOrRefresh({
        providerName: PROVIDER,
        context: CONTEXT,
        refresh,
      });

      // Degrades to the per-pod behaviour rather than failing the request.
      expect(result.token).toBe('fresh');
    });

    /**
     * The loser's path. It wants the winner's *result*, not the lock, so it
     * polls rather than queueing - and adopting is the whole point, since
     * minting its own is what would revoke the winner's.
     */
    it('waits for the winner and adopts what they publish', async () => {
      set.mockImplementation(async (key: string) =>
        key === LOCK_KEY ? null : 'OK',
      );
      let reads = 0;
      get.mockImplementation(async (key: string) => {
        if (key !== TOKEN_KEY) return null;
        reads += 1;
        return reads === 1 ? null : entry('winner-published');
      });
      const refresh = jest.fn(async () => minted('ours'));

      const result = await tokenRedis.getOrRefresh({
        providerName: PROVIDER,
        context: CONTEXT,
        refresh,
      });

      expect(result.token).toBe('winner-published');
      expect(refresh).not.toHaveBeenCalled();
    });

    /**
     * The safety valve. If the winner crashed we mint anyway rather than
     * failing the request: a duplicate refresh is survivable because the newest
     * token is always published and the pods reconverge on the next read. A
     * failed payment does not reconverge.
     */
    it('mints anyway when the lock holder never publishes', async () => {
      set.mockImplementation(async (key: string) =>
        key === LOCK_KEY ? null : 'OK',
      );
      const refresh = jest.fn(async () => minted('ours'));

      const result = await tokenRedis.getOrRefresh({
        providerName: PROVIDER,
        context: CONTEXT,
        refresh,
      });

      expect(result.token).toBe('ours');
      expect(refresh).toHaveBeenCalled();
    }, 15_000);

    it('does not write a token that has already expired', async () => {
      await tokenRedis.getOrRefresh({
        providerName: PROVIDER,
        context: CONTEXT,
        refresh: async () => ({
          token: 'dead',
          expiresAtSeconds: nowSeconds(),
        }),
      });

      expect(set.mock.calls.find(([key]) => key === TOKEN_KEY)).toBeUndefined();
    });
  });

  describe('refreshIfUnchanged', () => {
    /**
     * The check that stops a refresh storm. Two pods taking turns minting and
     * revoking each other's credentials is the failure this class exists to
     * prevent, and it starts precisely here.
     */
    it('adopts a sibling refresh instead of minting another', async () => {
      get.mockImplementation(async (key: string) =>
        key === TOKEN_KEY ? entry('sibling-already-refreshed') : null,
      );
      const refresh = jest.fn(async () => minted('ours'));

      const result = await tokenRedis.refreshIfUnchanged({
        providerName: PROVIDER,
        context: CONTEXT,
        staleToken: 'the-one-that-401d',
        refresh,
      });

      expect(result.token).toBe('sibling-already-refreshed');
      expect(refresh).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });

    it('invalidates and mints when the shared token is the dead one', async () => {
      let reads = 0;
      get.mockImplementation(async (key: string) => {
        if (key !== TOKEN_KEY) return null;
        reads += 1;
        return reads === 1 ? entry('the-one-that-401d') : null;
      });
      const refresh = jest.fn(async () => minted('fresh'));

      const result = await tokenRedis.refreshIfUnchanged({
        providerName: PROVIDER,
        context: CONTEXT,
        staleToken: 'the-one-that-401d',
        refresh,
      });

      expect(result.token).toBe('fresh');
      expect(del).toHaveBeenCalledWith(TOKEN_KEY);
      expect(refresh).toHaveBeenCalled();
    });

    it('mints when nothing is shared at all', async () => {
      const refresh = jest.fn(async () => minted('fresh'));

      const result = await tokenRedis.refreshIfUnchanged({
        providerName: PROVIDER,
        context: CONTEXT,
        staleToken: 'the-one-that-401d',
        refresh,
      });

      expect(result.token).toBe('fresh');
      expect(refresh).toHaveBeenCalled();
    });
  });

  describe('key naming', () => {
    it('separates products under one provider', async () => {
      for (const context of Object.values(TokenContext)) {
        set.mockClear();
        await tokenRedis.getOrRefresh({
          providerName: PROVIDER,
          context,
          refresh: async () => minted(`token-${context}`),
        });
        expect(
          set.mock.calls.some(
            ([key]) => key === `token:${PROVIDER}:${context}`,
          ),
        ).toBe(true);
      }
    });
  });
});
