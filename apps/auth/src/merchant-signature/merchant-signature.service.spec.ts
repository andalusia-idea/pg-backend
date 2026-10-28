import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  FilterMerchantSignatureValidationDto,
  MerchantSignatureFailureEnum,
  MerchantSignatureStatusEnum,
} from '@app/microservice';
import {
  buildCanonical,
  buildSignature,
  generateSecretKey,
  sha256Hex,
} from '@app/signature';
import { MerchantSignatureService } from './merchant-signature.service';

const USER_ID = 42;
const CLIENT_ID = '3f2b8c1d-4e5a-4b6c-8d9e-0a1b2c3d4e5f';
const NONCE = 'b7c1e2d3-4f5a-4b6c-8d9e-0a1b2c3d4e5f';

const GRACE_SECONDS = 86_400;

const secretKey = generateSecretKey();
const oldSecretKey = generateSecretKey();

const request = (): FilterMerchantSignatureValidationDto => ({
  clientId: CLIENT_ID,
  timestampIso: new Date().toISOString(),
  nonce: NONCE,
  signature: '',
  httpMethod: 'POST',
  endpoint: '/open/v1/payin/purchase',
  bodyHash: sha256Hex('{"amount":100000}'),
  ipAddress: '203.0.113.5',
});

/** Sign a request the way a correctly-integrated merchant would. */
const signedWith = (
  key: string,
  dto: FilterMerchantSignatureValidationDto = request(),
): FilterMerchantSignatureValidationDto => ({
  ...dto,
  signature: buildSignature({
    secretKey: key,
    canonical: buildCanonical({
      httpMethod: dto.httpMethod,
      endpoint: dto.endpoint,
      nonce: dto.nonce,
      bodyHash: dto.bodyHash,
      timestampIso: dto.timestampIso,
    }),
  }),
});

const activeRow = (overrides: Record<string, unknown> = {}) => ({
  userId: USER_ID,
  status: MerchantSignatureStatusEnum.ACTIVE,
  secretKey,
  secretKeyPrevious: null,
  secretKeyRotatedAt: null,
  allowedIps: [] as string[],
  ...overrides,
});

describe('MerchantSignatureService.validateSignature', () => {
  let findUnique: jest.Mock;
  let claimNonce: jest.Mock;
  let consumeRateLimit: jest.Mock;
  let getMerchantSignature: jest.Mock;
  let setMerchantSignature: jest.Mock;
  let service: MerchantSignatureService;

  beforeEach(() => {
    findUnique = jest.fn();
    claimNonce = jest.fn(async () => true);
    consumeRateLimit = jest.fn(async () => ({
      allowed: true,
      totalHits: 1,
      retryAfterSeconds: 60,
    }));
    getMerchantSignature = jest.fn(async () => null);
    setMerchantSignature = jest.fn(async () => undefined);

    const prismaMaster = { merchantSignature: { findUnique } };
    // The only value this service reads: the nonce and cache TTLs now belong
    // to MerchantSignatureRedis, and the timestamp tolerance to the guard.
    const config = { SECRET_KEY_GRACE_SECONDS: GRACE_SECONDS };

    service = new MerchantSignatureService(
      prismaMaster as never,
      {} as never,
      {
        claimNonce,
        consumeRateLimit,
        getMerchantSignature,
        setMerchantSignature,
      } as never,
      config as never,
    );
  });

  describe('caching', () => {
    it('reads through to the database on a miss and caches the row', async () => {
      findUnique.mockResolvedValue(activeRow() as never);

      await service.validateSignature(signedWith(secretKey));

      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(setMerchantSignature).toHaveBeenCalledWith(
        CLIENT_ID,
        expect.objectContaining({ userId: USER_ID }),
      );
    });

    it('skips the database entirely on a hit', async () => {
      getMerchantSignature.mockResolvedValue(activeRow() as never);

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.isValid).toBe(true);
      expect(findUnique).not.toHaveBeenCalled();
    });

    /**
     * Writing on a hit would refresh the TTL on every request, so a busy
     * merchant's entry would never expire - removing the only backstop if an
     * invalidation is ever missed.
     */
    it('does not rewrite the entry on a hit', async () => {
      getMerchantSignature.mockResolvedValue(activeRow() as never);

      await service.validateSignature(signedWith(secretKey));

      expect(setMerchantSignature).not.toHaveBeenCalled();
    });

    /** An unknown client must not be cached, or a just-onboarded merchant
     * reads as unknown for a full TTL. */
    it('does not cache an unknown client', async () => {
      findUnique.mockResolvedValue(null as never);

      await service.validateSignature(signedWith(secretKey));

      expect(setMerchantSignature).not.toHaveBeenCalled();
    });

    /**
     * JSON has no Date, so a cached row arrives with `secretKeyRotatedAt`
     * revived from epoch milliseconds. If that revive is ever dropped, the
     * grace-window check calls `.getTime()` on a number and throws.
     */
    it('honours the rotation grace window on a cached row', async () => {
      getMerchantSignature.mockResolvedValue(
        activeRow({
          secretKeyPrevious: oldSecretKey,
          secretKeyRotatedAt: new Date(Date.now() - 60_000),
        }) as never,
      );

      const result = await service.validateSignature(signedWith(oldSecretKey));

      expect(result.isValid).toBe(true);
    });
  });

  describe('client resolution', () => {
    it('rejects an unknown client with a null userId', async () => {
      findUnique.mockResolvedValue(null as never);

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.isValid).toBe(false);
      expect(result.reason).toBe(MerchantSignatureFailureEnum.UNKNOWN_CLIENT);
      expect(result.userId).toBeNull();
    });

    /** Soft-deleted credentials must not authenticate. */
    it('excludes soft-deleted rows from the lookup', async () => {
      findUnique.mockResolvedValue(activeRow() as never);
      await service.validateSignature(signedWith(secretKey));

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clientId: CLIENT_ID, deletedAt: null },
        }),
      );
    });

    it.each([
      MerchantSignatureStatusEnum.INACTIVE,
      MerchantSignatureStatusEnum.SUSPENDED,
    ])('rejects a client whose status is %s', async (status) => {
      findUnique.mockResolvedValue(activeRow({ status }) as never);

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.reason).toBe(MerchantSignatureFailureEnum.CLIENT_SUSPENDED);
      expect(result.userId).toBe(USER_ID);
    });

    it('reports a client that never generated a secret key', async () => {
      findUnique.mockResolvedValue(activeRow({ secretKey: null }) as never);

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.reason).toBe(
        MerchantSignatureFailureEnum.SECRET_KEY_NOT_GENERATED,
      );
    });
  });

  describe('signature verification', () => {
    it('accepts a correctly signed request', async () => {
      findUnique.mockResolvedValue(activeRow() as never);

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result).toEqual({
        isValid: true,
        userId: USER_ID,
        reason: null,
        serverTime: expect.any(String),
        retryAfterSeconds: null,
      });
    });

    it('rejects a request signed with the wrong secret', async () => {
      findUnique.mockResolvedValue(activeRow() as never);

      const result = await service.validateSignature(
        signedWith(generateSecretKey()),
      );

      expect(result.reason).toBe(
        MerchantSignatureFailureEnum.INVALID_SIGNATURE,
      );
    });

    it.each([
      ['endpoint', { endpoint: '/open/v1/payin/order' }],
      ['method', { httpMethod: 'GET' as const }],
      ['nonce', { nonce: 'd4c3b2a1-4f5a-4b6c-8d9e-0a1b2c3d4e5f' }],
      ['body hash', { bodyHash: sha256Hex('{"amount":999999}') }],
      ['timestamp', { timestampIso: '2026-01-01T00:00:00+07:00' }],
    ])(
      'rejects when the %s was tampered with after signing',
      async (_label, tamper) => {
        findUnique.mockResolvedValue(activeRow() as never);
        const signed = signedWith(secretKey);

        const result = await service.validateSignature({
          ...signed,
          ...tamper,
        });

        expect(result.reason).toBe(
          MerchantSignatureFailureEnum.INVALID_SIGNATURE,
        );
      },
    );
  });

  describe('secret key rotation', () => {
    const rotatedAgo = (seconds: number) =>
      new Date(Date.now() - seconds * 1000);

    it('accepts the previous key inside the grace window', async () => {
      findUnique.mockResolvedValue(
        activeRow({
          secretKeyPrevious: oldSecretKey,
          secretKeyRotatedAt: rotatedAgo(GRACE_SECONDS - 60),
        }) as never,
      );

      const result = await service.validateSignature(signedWith(oldSecretKey));

      expect(result.isValid).toBe(true);
    });

    it('rejects the previous key once the grace window has closed', async () => {
      findUnique.mockResolvedValue(
        activeRow({
          secretKeyPrevious: oldSecretKey,
          secretKeyRotatedAt: rotatedAgo(GRACE_SECONDS + 60),
        }) as never,
      );

      const result = await service.validateSignature(signedWith(oldSecretKey));

      expect(result.reason).toBe(
        MerchantSignatureFailureEnum.INVALID_SIGNATURE,
      );
    });

    /** No rotation timestamp means no window ever opened. */
    it('ignores a previous key with no rotation timestamp', async () => {
      findUnique.mockResolvedValue(
        activeRow({
          secretKeyPrevious: oldSecretKey,
          secretKeyRotatedAt: null,
        }) as never,
      );

      const result = await service.validateSignature(signedWith(oldSecretKey));

      expect(result.reason).toBe(
        MerchantSignatureFailureEnum.INVALID_SIGNATURE,
      );
    });

    it('still prefers the current key when both would be in date', async () => {
      findUnique.mockResolvedValue(
        activeRow({
          secretKeyPrevious: oldSecretKey,
          secretKeyRotatedAt: rotatedAgo(60),
        }) as never,
      );

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.isValid).toBe(true);
    });
  });

  describe('IP allowlist', () => {
    it('allows any origin when no allowlist is configured', async () => {
      findUnique.mockResolvedValue(activeRow({ allowedIps: [] }) as never);

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.isValid).toBe(true);
    });

    it('allows an origin inside the allowlist', async () => {
      findUnique.mockResolvedValue(
        activeRow({ allowedIps: ['203.0.113.0/24'] }) as never,
      );

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.isValid).toBe(true);
    });

    it('rejects an origin outside the allowlist', async () => {
      findUnique.mockResolvedValue(
        activeRow({ allowedIps: ['198.51.100.0/24'] }) as never,
      );

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.reason).toBe(MerchantSignatureFailureEnum.IP_NOT_ALLOWED);
      expect(result.userId).toBe(USER_ID);
    });

    /**
     * The ordering that gives this control its value. IP_NOT_ALLOWED is only
     * reachable once the signature has verified, so it means someone holding
     * the merchant's actual secret called from an unlisted address - the
     * highest-fidelity credential-compromise signal the system produces. If
     * origin were checked first, a bad signature from a bad IP would report
     * the IP, and a leaked secret would never announce itself.
     */
    it('reports an invalid signature rather than the origin when both are wrong', async () => {
      findUnique.mockResolvedValue(
        activeRow({ allowedIps: ['198.51.100.0/24'] }) as never,
      );

      const result = await service.validateSignature(
        signedWith(generateSecretKey()),
      );

      expect(result.reason).toBe(
        MerchantSignatureFailureEnum.INVALID_SIGNATURE,
      );
    });

    /**
     * A request rejected on origin must not burn its nonce, or a merchant who
     * corrects their allowlist and retries the same signed request would get
     * REPLAYED_NONCE instead of succeeding.
     */
    it('does not claim the nonce when the origin is rejected', async () => {
      findUnique.mockResolvedValue(
        activeRow({ allowedIps: ['198.51.100.0/24'] }) as never,
      );

      await service.validateSignature(signedWith(secretKey));

      expect(claimNonce).not.toHaveBeenCalled();
    });

    /** A misconfigured `trustProxy` must not silently disable the control. */
    it('rejects when the origin could not be resolved', async () => {
      findUnique.mockResolvedValue(
        activeRow({ allowedIps: ['203.0.113.0/24'] }) as never,
      );

      const result = await service.validateSignature({
        ...signedWith(secretKey),
        ipAddress: null,
      });

      expect(result.reason).toBe(MerchantSignatureFailureEnum.IP_NOT_ALLOWED);
    });
  });

  describe('rate limiting', () => {
    it('passes a request inside the budget through', async () => {
      findUnique.mockResolvedValue(activeRow() as never);

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.isValid).toBe(true);
      expect(consumeRateLimit).toHaveBeenCalledWith(
        CLIENT_ID,
        '/open/v1/payin/purchase',
      );
    });

    it('rejects an over-budget request with the retry hint', async () => {
      findUnique.mockResolvedValue(activeRow() as never);
      consumeRateLimit.mockResolvedValue({
        allowed: false,
        totalHits: 121,
        retryAfterSeconds: 17,
      } as never);

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.reason).toBe(MerchantSignatureFailureEnum.RATE_LIMITED);
      expect(result.retryAfterSeconds).toBe(17);
      expect(result.userId).toBe(USER_ID);
    });

    /**
     * A throttled request must not burn its nonce - otherwise the merchant's
     * retry once the window resets returns REPLAYED_NONCE and reads as a
     * completely different fault.
     */
    it('does not claim the nonce when throttled', async () => {
      findUnique.mockResolvedValue(activeRow() as never);
      consumeRateLimit.mockResolvedValue({
        allowed: false,
        totalHits: 121,
        retryAfterSeconds: 17,
      } as never);

      await service.validateSignature(signedWith(secretKey));

      expect(claimNonce).not.toHaveBeenCalled();
    });

    /**
     * The budget belongs to whoever holds the secret. Counting before the
     * signature verified would let a stranger spoofing a client id exhaust a
     * real merchant's quota.
     */
    it('does not spend budget on an invalid signature', async () => {
      findUnique.mockResolvedValue(activeRow() as never);

      await service.validateSignature(signedWith(generateSecretKey()));

      expect(consumeRateLimit).not.toHaveBeenCalled();
    });

    it('does not spend budget on a rejected origin', async () => {
      findUnique.mockResolvedValue(
        activeRow({ allowedIps: ['198.51.100.0/24'] }) as never,
      );

      await service.validateSignature(signedWith(secretKey));

      expect(consumeRateLimit).not.toHaveBeenCalled();
    });
  });

  describe('nonce replay', () => {
    /** The TTL is the Redis class's own concern now, not a call-site argument. */
    it('claims the nonce on success', async () => {
      findUnique.mockResolvedValue(activeRow() as never);

      await service.validateSignature(signedWith(secretKey));

      expect(claimNonce).toHaveBeenCalledWith(CLIENT_ID, NONCE);
    });

    it('rejects a nonce that was already claimed', async () => {
      findUnique.mockResolvedValue(activeRow() as never);
      claimNonce.mockResolvedValue(false as never);

      const result = await service.validateSignature(signedWith(secretKey));

      expect(result.reason).toBe(MerchantSignatureFailureEnum.REPLAYED_NONCE);
      expect(result.userId).toBe(USER_ID);
    });

    /**
     * The ordering that matters: claiming before the signature is verified
     * would let unauthenticated traffic populate the nonce store.
     */
    it('does not touch the nonce store when the signature is invalid', async () => {
      findUnique.mockResolvedValue(activeRow() as never);

      await service.validateSignature(signedWith(generateSecretKey()));

      expect(claimNonce).not.toHaveBeenCalled();
    });

    it('does not touch the nonce store for an unknown client', async () => {
      findUnique.mockResolvedValue(null as never);

      await service.validateSignature(signedWith(secretKey));

      expect(claimNonce).not.toHaveBeenCalled();
    });

    /**
     * Fail closed. An unreachable nonce store is an outage, not a bad
     * signature - it must not resolve to `isValid: false`, which would tell
     * the merchant something untrue and unfixable.
     */
    it('propagates a nonce store failure instead of rejecting', async () => {
      findUnique.mockResolvedValue(activeRow() as never);
      claimNonce.mockRejectedValue(new Error('redis unreachable') as never);

      await expect(
        service.validateSignature(signedWith(secretKey)),
      ).rejects.toThrow('redis unreachable');
    });
  });

  describe('serverTime', () => {
    it.each([
      ['success', () => activeRow()],
      [
        'rejection',
        () => activeRow({ status: MerchantSignatureStatusEnum.SUSPENDED }),
      ],
    ])('is a valid ISO-8601 instant on %s', async (_label, row) => {
      findUnique.mockResolvedValue(row() as never);

      const { serverTime } = await service.validateSignature(
        signedWith(secretKey),
      );

      expect(serverTime).not.toBe('');
      expect(Number.isNaN(new Date(serverTime).getTime())).toBe(false);
    });
  });
});
