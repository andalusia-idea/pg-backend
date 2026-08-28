import { describe, expect, it } from '@jest/globals';
import Ajv from 'ajv';
import {
  FilterMerchantSignatureValidationSchema,
  MerchantSignatureValidationSchema,
} from './merchant-signature.dto';
import { MerchantSignatureFailureEnum } from '../merchant.enum';

/**
 * Same options as {@link AjvPipe}, so these tests exercise the schemas the way
 * the message handler actually will - `removeAdditional` in particular changes
 * behaviour rather than just error reporting.
 */
const ajv = new Ajv({
  coerceTypes: true,
  removeAdditional: true,
  allErrors: true,
});

const validateRequest = ajv.compile(FilterMerchantSignatureValidationSchema);
const validateResponse = ajv.compile(MerchantSignatureValidationSchema);

const UUID = '3f2b8c1d-4e5a-4b6c-8d9e-0a1b2c3d4e5f';

const validRequest = () => ({
  clientId: UUID,
  timestampIso: '2026-08-23T10:15:30+07:00',
  nonce: UUID,
  signature: 'a'.repeat(128),
  httpMethod: 'POST',
  endpoint: '/open/v1/payin/purchase',
  bodyHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ipAddress: '203.0.113.5',
});

const withRequest = (mutate: (payload: Record<string, unknown>) => void) => {
  const payload = validRequest() as Record<string, unknown>;
  mutate(payload);
  return validateRequest(payload) === true;
};

describe('FilterMerchantSignatureValidationSchema', () => {
  it('accepts a well-formed payload', () => {
    expect(withRequest(() => {})).toBe(true);
  });

  it('accepts both supported HTTP verbs', () => {
    expect(withRequest((p) => (p.httpMethod = 'GET'))).toBe(true);
    expect(withRequest((p) => (p.httpMethod = 'POST'))).toBe(true);
  });

  /**
   * HMAC-SHA512 is 64 bytes, so the hex form is exactly 128 characters. The
   * guard rejects anything else with MALFORMED_SIGNATURE before it gets here,
   * so a violation at this layer means the guard is broken - fail loudly.
   */
  it.each([
    ['one character short', 'a'.repeat(127)],
    ['one character long', 'a'.repeat(129)],
    ['sha256 length', 'a'.repeat(64)],
    ['non-hex characters', 'z'.repeat(128)],
    ['empty', ''],
  ])('rejects a signature that is %s', (_label, signature) => {
    expect(withRequest((p) => (p.signature = signature))).toBe(false);
  });

  /**
   * `bodyHash` is computed by the guard via `sha256Hex`, which always emits
   * lowercase - uppercase here would mean something re-encoded it in transit.
   */
  it.each([
    [
      'uppercase',
      'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855',
    ],
    ['too short', 'a'.repeat(63)],
    ['too long', 'a'.repeat(65)],
    ['non-hex', 'z'.repeat(64)],
  ])('rejects a body hash that is %s', (_label, bodyHash) => {
    expect(withRequest((p) => (p.bodyHash = bodyHash))).toBe(false);
  });

  it.each([['PUT'], ['DELETE'], ['PATCH'], ['post']])(
    'rejects the unsupported method %s',
    (method) => {
      expect(withRequest((p) => (p.httpMethod = method))).toBe(false);
    },
  );

  it('rejects a nonce shorter than the minimum', () => {
    expect(withRequest((p) => (p.nonce = 'a'.repeat(7)))).toBe(false);
  });

  it.each([
    ['clientId'],
    ['timestampIso'],
    ['nonce'],
    ['signature'],
    ['httpMethod'],
    ['endpoint'],
    ['bodyHash'],
    ['ipAddress'],
  ])('rejects a payload missing %s', (field) => {
    expect(withRequest((p) => delete p[field])).toBe(false);
  });

  /**
   * `additionalProperties: false` plus `removeAdditional` strips rather than
   * rejects. Worth pinning: a field silently vanishing is harder to notice
   * than one that throws.
   */
  it('strips unknown properties instead of rejecting them', () => {
    const payload = { ...validRequest(), sneaky: 'x' } as Record<
      string,
      unknown
    >;
    expect(validateRequest(payload)).toBe(true);
    expect(payload).not.toHaveProperty('sneaky');
  });
});

describe('MerchantSignatureValidationSchema', () => {
  it('accepts a successful verification', () => {
    expect(
      validateResponse({
        isValid: true,
        userId: 42,
        reason: null,
        serverTime: '2026-08-23T10:15:30+07:00',
      }),
    ).toBe(true);
  });

  /** No client resolved means no user id - null, never 0. */
  it('accepts a null userId alongside a failure reason', () => {
    expect(
      validateResponse({
        isValid: false,
        userId: null,
        reason: MerchantSignatureFailureEnum.UNKNOWN_CLIENT,
        serverTime: '2026-08-23T10:15:30+07:00',
      }),
    ).toBe(true);
  });

  it.each(Object.values(MerchantSignatureFailureEnum))(
    'accepts the failure reason %s',
    (reason) => {
      expect(
        validateResponse({
          isValid: false,
          userId: null,
          reason,
          serverTime: '2026-08-23T10:15:30+07:00',
        }),
      ).toBe(true);
    },
  );

  it('rejects a reason outside the enum', () => {
    expect(
      validateResponse({
        isValid: false,
        userId: null,
        reason: 'SOMETHING_ELSE',
        serverTime: '2026-08-23T10:15:30+07:00',
      }),
    ).toBe(false);
  });

  /** Always populated so the guard can echo it on a skew rejection. */
  it('requires serverTime', () => {
    expect(validateResponse({ isValid: true, userId: 42, reason: null })).toBe(
      false,
    );
  });
});
