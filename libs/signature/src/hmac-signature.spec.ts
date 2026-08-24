import { describe, expect, it } from '@jest/globals';
import {
  buildCanonical,
  buildSignature,
  EMPTY_BODY_SHA256,
  generateClientId,
  generateNonce,
  generateSecretKey,
  isTimestampWithin,
  sha256Hex,
  verifySignature,
} from './hmac-signature';

/**
 * Fixed inputs so a signature change shows up as a failing test rather than
 * silently breaking every merchant integration.
 */
const SECRET =
  '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0';
const TIMESTAMP = '2026-08-23T10:15:30+07:00';
const NONCE = '3f2b8c1d-4e5a-4b6c-8d9e-0a1b2c3d4e5f';
const ENDPOINT = '/open/v1/payin/purchase';

/** HMAC-SHA512 produces 64 bytes = 128 lowercase hex characters. */
const SIGNATURE_HEX_LENGTH = 128;

/** Enough to catch a generator that stopped being random, without being slow. */
const UNIQUENESS_SAMPLES = 1_000;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const canonicalFor = (bodyHash: string = EMPTY_BODY_SHA256) =>
  buildCanonical({
    httpMethod: 'POST',
    endpoint: ENDPOINT,
    nonce: NONCE,
    bodyHash,
    timestampIso: TIMESTAMP,
  });

describe('generateSecretKey', () => {
  it('returns 32 bytes of entropy encoded as hex', () => {
    const secretKey = generateSecretKey();
    expect(secretKey).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(secretKey, 'hex')).toHaveLength(32);
  });

  it('never repeats', () => {
    const keys = new Set(
      Array.from({ length: UNIQUENESS_SAMPLES }, () => generateSecretKey()),
    );
    expect(keys.size).toBe(UNIQUENESS_SAMPLES);
  });
});

describe('generateClientId', () => {
  /**
   * Legacy built this as `${userId}-${uuid}`, which published an internal
   * primary key to every merchant. It must stay opaque.
   */
  it('is a UUID v4 carrying no internal identifier', () => {
    expect(generateClientId()).toMatch(UUID_V4);
  });

  it('never repeats', () => {
    const ids = new Set(
      Array.from({ length: UNIQUENESS_SAMPLES }, () => generateClientId()),
    );
    expect(ids.size).toBe(UNIQUENESS_SAMPLES);
  });
});

describe('generateNonce', () => {
  it('is a UUID v4', () => {
    expect(generateNonce()).toMatch(UUID_V4);
  });

  /**
   * The canonical string is colon-delimited, so a nonce containing a colon
   * could shift a field boundary and let two different requests produce the
   * same string to sign. A UUID cannot contain one.
   */
  it('contains no colon', () => {
    expect(generateNonce()).not.toContain(':');
  });

  it('never repeats', () => {
    const nonces = new Set(
      Array.from({ length: UNIQUENESS_SAMPLES }, () => generateNonce()),
    );
    expect(nonces.size).toBe(UNIQUENESS_SAMPLES);
  });
});

describe('sha256Hex', () => {
  it('hashes the empty string to the documented constant', () => {
    expect(sha256Hex('')).toBe(EMPTY_BODY_SHA256);
  });

  it('returns lowercase hex', () => {
    expect(sha256Hex('{"amount":100000}')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats a string and its UTF-8 buffer identically', () => {
    const body = '{"amount":100000}';
    expect(sha256Hex(body)).toBe(sha256Hex(Buffer.from(body, 'utf8')));
  });

  /**
   * The reason the server must hash raw bytes rather than re-serialise the
   * parsed body: `JSON.parse` then `JSON.stringify` is not a round trip, so
   * re-serialising would hash something the merchant never sent.
   */
  it.each([
    ['integer-like keys are reordered', '{"2":"a","1":"b"}'],
    ['trailing zeros are dropped', '{"amount":1.50}'],
    ['exponents are expanded', '{"amount":1e3}'],
    ['whitespace is stripped', '{\n  "amount": 1\n}'],
  ])('%s, so re-serialising changes the hash', (_label, wire) => {
    const reserialised = JSON.stringify(JSON.parse(wire));
    expect(reserialised).not.toBe(wire);
    expect(sha256Hex(reserialised)).not.toBe(sha256Hex(wire));
  });
});

describe('isTimestampWithin', () => {
  /** 2026-08-23T10:15:30+07:00 as epoch milliseconds. */
  const NOW = new Date(TIMESTAMP).getTime();
  const TOLERANCE = 300;

  const at = (offsetSeconds: number) =>
    new Date(NOW + offsetSeconds * 1000).toISOString();

  const check = (timestampIso: string) =>
    isTimestampWithin({ timestampIso, toleranceSeconds: TOLERANCE, now: NOW });

  it('accepts the current instant', () => {
    expect(check(at(0))).toBe(true);
  });

  it.each([
    ['just inside the past edge', -TOLERANCE + 1],
    ['exactly on the past edge', -TOLERANCE],
    ['exactly on the future edge', TOLERANCE],
    ['just inside the future edge', TOLERANCE - 1],
  ])('accepts a timestamp %s', (_label, offsetSeconds) => {
    expect(check(at(offsetSeconds))).toBe(true);
  });

  /** A merchant's clock can run fast as easily as slow. */
  it.each([
    ['too far in the past', -TOLERANCE - 1],
    ['too far in the future', TOLERANCE + 1],
  ])('rejects a timestamp %s', (_label, offsetSeconds) => {
    expect(check(at(offsetSeconds))).toBe(false);
  });

  it('accepts the same instant expressed in a different offset', () => {
    expect(check('2026-08-23T03:15:30Z')).toBe(true);
    expect(check('2026-08-23T10:15:30+07:00')).toBe(true);
  });

  it.each([
    ['milliseconds', '2026-08-23T10:15:30.000+07:00'],
    ['microseconds', '2026-08-23T10:15:30.000000+07:00'],
  ])('accepts fractional seconds in %s', (_label, timestampIso) => {
    expect(check(timestampIso)).toBe(true);
  });

  /**
   * The important case. Without an offset, `new Date` resolves against the
   * server's local zone, so this string would mean different instants on a
   * WIB host and a UTC host. It must be rejected as malformed rather than
   * silently reinterpreted.
   */
  it('rejects a timestamp carrying no UTC offset', () => {
    expect(check('2026-08-23T10:15:30')).toBe(false);
  });

  it.each([
    ['date only', '2026-08-23'],
    ['year only', '2026'],
    ['human readable', 'Aug 23 2026'],
    ['unparseable', 'garbage'],
    ['empty', ''],
    ['whitespace', ' '],
    ['epoch milliseconds', String(NOW)],
    ['impossible month', '2026-13-23T10:15:30+07:00'],
    ['impossible day', '2026-08-45T10:15:30+07:00'],
    ['impossible hour', '2026-08-23T99:15:30+07:00'],
    ['offset without colon', '2026-08-23T10:15:30+0700'],
    ['space instead of T', '2026-08-23 10:15:30+07:00'],
  ])('rejects %s', (_label, timestampIso) => {
    expect(check(timestampIso)).toBe(false);
  });

  it('defaults to the real clock when now is not supplied', () => {
    expect(
      isTimestampWithin({
        timestampIso: new Date().toISOString(),
        toleranceSeconds: TOLERANCE,
      }),
    ).toBe(true);
  });
});

describe('buildCanonical', () => {
  it('joins method, endpoint, nonce, body hash and timestamp with colons', () => {
    expect(canonicalFor()).toBe(
      `POST:${ENDPOINT}:${NONCE}:${EMPTY_BODY_SHA256}:${TIMESTAMP}`,
    );
  });

  it('carries the body hash it was given, unmodified', () => {
    const bodyHash = sha256Hex('{"amount":100000}');
    expect(canonicalFor(bodyHash)).toContain(bodyHash);
  });

  it('changes when any single component changes', () => {
    const bodyHash = sha256Hex('{"amount":100000}');
    const base = canonicalFor(bodyHash);

    const variants = [
      { httpMethod: 'GET' as const },
      { endpoint: '/open/v1/payin/order' },
      { nonce: 'a-different-nonce' },
      { bodyHash: sha256Hex('{"amount":100001}') },
      { timestampIso: '2026-08-23T10:15:31+07:00' },
    ];

    for (const override of variants) {
      expect(
        buildCanonical({
          httpMethod: 'POST',
          endpoint: ENDPOINT,
          nonce: NONCE,
          bodyHash,
          timestampIso: TIMESTAMP,
          ...override,
        }),
      ).not.toBe(base);
    }
  });
});

describe('buildSignature', () => {
  it('is deterministic for the same secret and canonical string', () => {
    const canonical = canonicalFor();
    expect(buildSignature({ secretKey: SECRET, canonical })).toBe(
      buildSignature({ secretKey: SECRET, canonical }),
    );
  });

  it('returns lowercase hex of the expected length', () => {
    const signature = buildSignature({
      secretKey: SECRET,
      canonical: canonicalFor(),
    });
    expect(signature).toHaveLength(SIGNATURE_HEX_LENGTH);
    expect(signature).toMatch(/^[0-9a-f]+$/);
  });

  it('changes with the secret', () => {
    const canonical = canonicalFor();
    expect(buildSignature({ secretKey: SECRET, canonical })).not.toBe(
      buildSignature({ secretKey: generateSecretKey(), canonical }),
    );
  });

  it('changes with the canonical string', () => {
    expect(
      buildSignature({ secretKey: SECRET, canonical: canonicalFor() }),
    ).not.toBe(
      buildSignature({
        secretKey: SECRET,
        canonical: canonicalFor(sha256Hex('{"amount":1}')),
      }),
    );
  });
});

describe('verifySignature', () => {
  const canonical = canonicalFor(sha256Hex('{"amount":100000}'));
  const signature = buildSignature({ secretKey: SECRET, canonical });

  it('accepts a signature produced by the same secret', () => {
    expect(
      verifySignature({
        secretKey: SECRET,
        canonical,
        signatureReceived: signature,
      }),
    ).toBe(true);
  });

  it('rejects a signature produced by a different secret', () => {
    expect(
      verifySignature({
        secretKey: generateSecretKey(),
        canonical,
        signatureReceived: signature,
      }),
    ).toBe(false);
  });

  it('rejects when the signed content was tampered with', () => {
    expect(
      verifySignature({
        secretKey: SECRET,
        canonical: canonicalFor(sha256Hex('{"amount":999999}')),
        signatureReceived: signature,
      }),
    ).toBe(false);
  });

  it('rejects a single flipped character', () => {
    const flipped = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);
    expect(
      verifySignature({
        secretKey: SECRET,
        canonical,
        signatureReceived: flipped,
      }),
    ).toBe(false);
  });

  /**
   * Regression guard. `timingSafeEqual` throws `RangeError` when the two
   * buffers differ in length, which turned a bad signature into an HTTP 500
   * in the legacy service. Every malformed input below must return false.
   *
   * Note `Buffer.from(str, 'hex')` silently stops at the first non-hex
   * character, so 'zz' and '' both decode to zero bytes - they are caught by
   * the same length guard rather than needing a separate format check.
   */
  describe('malformed signatures return false instead of throwing', () => {
    const malformed: Array<[string, string]> = [
      ['too short', 'ab'],
      ['one character short', signature.slice(0, -1)],
      ['one character long', `${signature}ff`],
      ['odd length', 'abc'],
      ['empty', ''],
      ['whitespace', ' '],
      ['non-hex', 'zz'],
      ['hex prefix then garbage', 'deadbeefzz'],
      ['sha256-length instead of sha512', signature.slice(0, 64)],
    ];

    it.each(malformed)('%s', (_label, signatureReceived) => {
      expect(() =>
        verifySignature({ secretKey: SECRET, canonical, signatureReceived }),
      ).not.toThrow();

      expect(
        verifySignature({ secretKey: SECRET, canonical, signatureReceived }),
      ).toBe(false);
    });
  });

  /**
   * Documents current behaviour rather than endorsing it: `Buffer.from` is
   * case-insensitive, so an uppercase signature verifies even though the spec
   * says lowercase. If merchants must send lowercase, the guard has to
   * enforce it - this function will not.
   */
  it('accepts uppercase hex', () => {
    expect(
      verifySignature({
        secretKey: SECRET,
        canonical,
        signatureReceived: signature.toUpperCase(),
      }),
    ).toBe(true);
  });
});

describe('round trip', () => {
  it('verifies a signature built from freshly generated credentials', () => {
    const secretKey = generateSecretKey();
    const body = JSON.stringify({
      amount: 100_000,
      orderId: 'ORD-1',
      currency: 'IDR',
    });

    const canonical = buildCanonical({
      httpMethod: 'POST',
      endpoint: ENDPOINT,
      nonce: generateNonce(),
      bodyHash: sha256Hex(body),
      timestampIso: new Date().toISOString(),
    });

    expect(
      verifySignature({
        secretKey,
        canonical,
        signatureReceived: buildSignature({ secretKey, canonical }),
      }),
    ).toBe(true);
  });

  it('verifies a GET with no body', () => {
    const secretKey = generateSecretKey();
    const canonical = buildCanonical({
      httpMethod: 'GET',
      endpoint: `${ENDPOINT}/242`,
      nonce: generateNonce(),
      bodyHash: sha256Hex(''),
      timestampIso: new Date().toISOString(),
    });

    expect(
      verifySignature({
        secretKey,
        canonical,
        signatureReceived: buildSignature({ secretKey, canonical }),
      }),
    ).toBe(true);
  });
});
