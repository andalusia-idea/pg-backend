import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  MerchantException,
  MerchantSignatureFailureEnum,
} from '@app/microservice';
import { EMPTY_BODY_SHA256, sha256Hex } from '@app/signature';
import { ExecutionContext } from '@nestjs/common';
import { MerchantSignatureGuard } from './merchant-signature.guard';
import { MERCHANT_USER_ID_KEY } from './merchant-user-id.decorator';

const USER_ID = 42;
const CLIENT_ID = '3f2b8c1d-4e5a-4b6c-8d9e-0a1b2c3d4e5f';
const NONCE = 'b7c1e2d3-4f5a-4b6c-8d9e-0a1b2c3d4e5f';
const SIGNATURE = 'a'.repeat(128);

const validHeaders = () => ({
  'content-type': 'application/json',
  'x-client-id': CLIENT_ID,
  'x-timestamp': new Date().toISOString(),
  'x-nonce': NONCE,
  'x-signature': SIGNATURE,
});

/** Minimal ExecutionContext over a fake Fastify request. */
const httpContext = (req: Record<string, unknown>): ExecutionContext =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const request = (overrides: Record<string, unknown> = {}) => ({
  method: 'POST',
  url: '/open/v1/payin/purchase',
  headers: validHeaders(),
  rawBody: Buffer.from('{"amount":100000}'),
  ...overrides,
});

/** Assert a MerchantException carrying the code that reason maps to. */
const expectRejection = async (
  promise: Promise<unknown>,
  reason: MerchantSignatureFailureEnum,
) => {
  const expected = MerchantException.fromMerchantSignature(reason);
  await expect(promise).rejects.toMatchObject({
    httpStatus: expected.httpStatus,
    response: { responseCode: expected.response.responseCode },
  });
};

describe('MerchantSignatureGuard', () => {
  let validateSignature: jest.Mock;
  let clsSet: jest.Mock;
  let guard: MerchantSignatureGuard;

  beforeEach(() => {
    validateSignature = jest.fn(() => ({
      isValid: true,
      userId: USER_ID,
      reason: null,
      serverTime: new Date().toISOString(),
      retryAfterSeconds: null,
    }));
    clsSet = jest.fn();

    guard = new MerchantSignatureGuard(
      { validateSignature } as never,
      { TIMESTAMP_TOLERANCE_SECONDS: 300 } as never,
      { set: clsSet } as never,
    );
  });

  it('accepts a well-formed request and records the merchant', async () => {
    await expect(guard.canActivate(httpContext(request()))).resolves.toBe(true);
    expect(clsSet).toHaveBeenCalledWith(MERCHANT_USER_ID_KEY, USER_ID);
  });

  /**
   * A globally-registered guard also fires for TCP message handlers, which
   * have no HTTP headers. Missing this breaks every internal microservice
   * call in a way that looks unrelated.
   */
  it('lets non-HTTP contexts straight through', async () => {
    const rpc = { getType: () => 'rpc' } as unknown as ExecutionContext;

    await expect(guard.canActivate(rpc)).resolves.toBe(true);
    expect(validateSignature).not.toHaveBeenCalled();
  });

  describe('header presence', () => {
    it.each([['x-client-id'], ['x-timestamp'], ['x-nonce'], ['x-signature']])(
      'rejects a request missing %s',
      async (header) => {
        const headers = validHeaders();
        delete (headers as Record<string, unknown>)[header];

        await expectRejection(
          guard.canActivate(httpContext(request({ headers }))),
          MerchantSignatureFailureEnum.MISSING_HEADER,
        );
        expect(validateSignature).not.toHaveBeenCalled();
      },
    );

    it('names the missing headers in the message', async () => {
      const headers = validHeaders();
      delete (headers as Record<string, unknown>)['x-nonce'];
      delete (headers as Record<string, unknown>)['x-signature'];

      await expect(
        guard.canActivate(httpContext(request({ headers }))),
      ).rejects.toMatchObject({
        response: {
          responseMessage: expect.stringContaining('x-nonce, x-signature'),
        },
      });
    });

    /**
     * A repeated header arrives as an array. Taking `[0]` would let a caller
     * send two signatures and have one silently ignored.
     */
    it('treats a duplicated header as absent', async () => {
      const headers = { ...validHeaders(), 'x-signature': [SIGNATURE, 'x'] };

      await expectRejection(
        guard.canActivate(httpContext(request({ headers }))),
        MerchantSignatureFailureEnum.MISSING_HEADER,
      );
    });
  });

  describe('content type', () => {
    /** `application/json; charset=utf-8` is entirely standard. */
    it('accepts a charset parameter on POST', async () => {
      const headers = {
        ...validHeaders(),
        'content-type': 'application/json; charset=utf-8',
      };

      await expect(
        guard.canActivate(httpContext(request({ headers }))),
      ).resolves.toBe(true);
    });

    /** A GET carries no body, so merchants will not send Content-Type. */
    it('does not require it on GET', async () => {
      const headers = validHeaders();
      delete (headers as Record<string, unknown>)['content-type'];

      await expect(
        guard.canActivate(
          httpContext(request({ method: 'GET', headers, rawBody: undefined })),
        ),
      ).resolves.toBe(true);
    });

    it('rejects a non-JSON POST', async () => {
      const headers = { ...validHeaders(), 'content-type': 'text/plain' };

      await expectRejection(
        guard.canActivate(httpContext(request({ headers }))),
        MerchantSignatureFailureEnum.MISSING_HEADER,
      );
    });
  });

  describe('local format checks happen before any network call', () => {
    it.each([
      ['127 chars', 'a'.repeat(127)],
      ['129 chars', 'a'.repeat(129)],
      ['sha256 length', 'a'.repeat(64)],
      ['non-hex', 'z'.repeat(128)],
    ])('rejects a signature of %s', async (_label, signature) => {
      const headers = { ...validHeaders(), 'x-signature': signature };

      await expectRejection(
        guard.canActivate(httpContext(request({ headers }))),
        MerchantSignatureFailureEnum.MALFORMED_SIGNATURE,
      );
      expect(validateSignature).not.toHaveBeenCalled();
    });

    /**
     * The canonical string is colon-delimited, so a colon-bearing nonce could
     * shift a field boundary and make one signature valid for two requests.
     */
    it.each([
      ['contains a colon', 'abc:def:ghi12345'],
      ['too short', 'abc'],
      ['contains a space', 'ORD 000001'],
      ['contains a slash', 'ORD/000001'],
    ])('rejects a nonce that %s', async (_label, nonce) => {
      const headers = { ...validHeaders(), 'x-nonce': nonce };

      await expectRejection(
        guard.canActivate(httpContext(request({ headers }))),
        MerchantSignatureFailureEnum.MALFORMED_NONCE,
      );
      expect(validateSignature).not.toHaveBeenCalled();
    });

    /**
     * A nonce is not restricted to hex - only `:` is genuinely forbidden,
     * because the canonical string is colon-delimited.
     */
    it.each([
      ['a UUID', 'b7c1e2d3-4f5a-4b6c-8d9e-0a1b2c3d4e5f'],
      ['a merchant order reference', 'ORD-000001'],
      ['a plain counter', '00000001'],
      ['hex', 'deadbeefdeadbeef'],
      ['unreserved punctuation', 'ord_2026.08~01-x'],
    ])('accepts a nonce that is %s', async (_label, nonce) => {
      const headers = { ...validHeaders(), 'x-nonce': nonce };

      await expect(
        guard.canActivate(httpContext(request({ headers }))),
      ).resolves.toBe(true);
    });

    it.each([
      ['no UTC offset', '2026-08-26T10:15:30'],
      ['outside tolerance', new Date(Date.now() - 3600_000).toISOString()],
      ['unparseable', 'not-a-timestamp'],
      ['date only', '2026-08-26'],
    ])('rejects a timestamp with %s', async (_label, timestamp) => {
      const headers = { ...validHeaders(), 'x-timestamp': timestamp };

      await expectRejection(
        guard.canActivate(httpContext(request({ headers }))),
        MerchantSignatureFailureEnum.TIMESTAMP_SKEW,
      );
      expect(validateSignature).not.toHaveBeenCalled();
    });
  });

  describe('payload sent to auth', () => {
    it('hashes the raw bytes and passes the url verbatim', async () => {
      const rawBody = Buffer.from('{"amount":100000}');
      await guard.canActivate(
        httpContext(
          request({ rawBody, url: '/open/v1/payin/purchase?trace=1' }),
        ),
      );

      expect(validateSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          bodyHash: sha256Hex(rawBody),
          endpoint: '/open/v1/payin/purchase?trace=1',
          httpMethod: 'POST',
          clientId: CLIENT_ID,
        }),
      );
    });

    it('uses the empty-body hash when there is no body', async () => {
      await guard.canActivate(
        httpContext(request({ method: 'GET', rawBody: undefined })),
      );

      expect(validateSignature).toHaveBeenCalledWith(
        expect.objectContaining({ bodyHash: EMPTY_BODY_SHA256 }),
      );
    });
  });

  describe('verification outcome', () => {
    it.each(Object.values(MerchantSignatureFailureEnum))(
      'surfaces %s with its own response code',
      async (reason) => {
        validateSignature.mockResolvedValue({
          isValid: false,
          userId: null,
          reason,
          serverTime: '2026-08-26T10:15:30+07:00',
          retryAfterSeconds: null,
        } as never);

        await expectRejection(
          guard.canActivate(httpContext(request())),
          reason,
        );
        expect(clsSet).not.toHaveBeenCalled();
      },
    );

    /** SNAP uses 409 Conflict for a reused external id; a replay is that. */
    it('answers a replayed nonce with 409, not 401', async () => {
      validateSignature.mockResolvedValue({
        isValid: false,
        userId: USER_ID,
        reason: MerchantSignatureFailureEnum.REPLAYED_NONCE,
        serverTime: '2026-08-26T10:15:30+07:00',
        retryAfterSeconds: null,
      } as never);

      await expect(
        guard.canActivate(httpContext(request())),
      ).rejects.toMatchObject({ httpStatus: 409 });
    });

    /** So the merchant can diagnose drift without opening a ticket. */
    it("echoes the verifier's clock rather than its own", async () => {
      validateSignature.mockResolvedValue({
        isValid: false,
        userId: null,
        reason: MerchantSignatureFailureEnum.TIMESTAMP_SKEW,
        serverTime: '2026-08-26T10:15:30+07:00',
        retryAfterSeconds: null,
      } as never);

      await expect(
        guard.canActivate(httpContext(request())),
      ).rejects.toMatchObject({
        response: { serverTime: '2026-08-26T10:15:30+07:00' },
      });
    });
  });

  /**
   * An unreachable verifier is an outage, not a bad signature. A 401 here
   * would send every merchant to debug signing code that is fine, and tell
   * well-behaved clients to stop retrying transactions that would succeed.
   */
  describe('when verification cannot be performed', () => {
    it.each([
      ['auth threw', { status: 'error', message: 'Internal server error' }],
      ['auth unreachable', new Error('connect ECONNREFUSED')],
      ['auth timed out', new Error('Timeout has occurred')],
    ])('answers 503 rather than 401 when %s', async (_label, failure) => {
      validateSignature.mockRejectedValue(failure as never);

      await expect(
        guard.canActivate(httpContext(request())),
      ).rejects.toMatchObject({
        httpStatus: 503,
        response: { responseCode: '5030000' },
      });
    });
  });
});
