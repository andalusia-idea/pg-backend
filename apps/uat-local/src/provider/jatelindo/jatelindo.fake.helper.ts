import { randomUUID } from 'node:crypto';

/**
 * Jatelindo's own response codes, from the spec's response-code table.
 *
 * **Transcribed, not imported from `JATELINDO_RESPONSE_CODE`.** Same rule as
 * the payload shapes: a fake that reads the client's own table cannot catch a
 * wrong entry in it, because both sides would agree on the same wrong code.
 * Only the five the fake actually emits are here - the client's table carries
 * fourteen, and copying the rest would invite exactly the drift this file is
 * trying to stay sensitive to.
 */
export const JATELINDO_CODE = {
  /** `A00 PROCESSED` - done, verified. Maps to SUCCESS. */
  PROCESSED: 'A00',
  /** `A01 REQUESTED` - accepted, outcome to follow. Maps to PENDING. */
  REQUESTED: 'A01',
  /** `T40 TRANSACTION_FAILED` - refused, verified. Maps to FAILED. */
  FAILED: 'T40',
  /** `E18 TIMEOUT` - `Need Check = Y`. SUSPECT, so it maps to PENDING. */
  TIMEOUT: 'E18',
  /** `S84 NO_TRANSACTION` - nothing found by that reference. */
  NO_TRANSACTION: 'S84',
} as const;
export type JatelindoCode =
  (typeof JATELINDO_CODE)[keyof typeof JATELINDO_CODE];

/**
 * The three-field envelope every Jatelindo response carries.
 *
 * `message` and `description` hold the same text here. The real provider
 * sometimes differs between them, and the client reads `message`; filling both
 * keeps `JatelindoSingleTransferResponseSchema` satisfied without inventing a
 * second sentence that would read as meaningful.
 */
export const jatelindoEnvelope = (
  responseCode: JatelindoCode,
  message: string,
): { responseCode: string; message: string; description: string } => ({
  responseCode,
  message,
  description: message,
});

/**
 * How long the fake's session token claims to live.
 *
 * Must comfortably exceed `JATELINDO_TOKEN_SKEW_SECONDS` (300 in `.env.test`):
 * the client caches until `exp - skew`, so a TTL at or below the skew collapses
 * to "already expired" and every request logs in again.
 */
export const FAKE_TOKEN_TTL_SECONDS = 30 * 60;

/**
 * An unsigned JWT carrying a real `exp`, not the opaque `fake-${randomUUID()}`
 * the design sketch suggests.
 *
 * `JatelindoTransferAuthService.resolveExpiry` derives its cache deadline from
 * the token's own `exp` claim through `readJwtExpSeconds`, and warns and
 * declines to cache when it cannot read one. An opaque string therefore works,
 * but it makes every inquiry and every transfer log in first, and the token
 * cache - including the shared Redis `getOrRefresh` under
 * `TokenContext.TRANSFER` - is then never exercised at all.
 *
 * The same reasoning as `mintFakeToken` in the MotionPay fake, and written out
 * again rather than shared with it: the two fakes imitate two unrelated
 * providers, and a helper they both reach for is the beginning of a harness
 * where a change to one silently changes the other.
 *
 * `alg: none` and a literal signature, so it is obvious at a glance that
 * nothing could be verifying this.
 */
export function mintJatelindoToken(
  ttlSeconds: number = FAKE_TOKEN_TTL_SECONDS,
): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const segment = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  return [
    segment({ alg: 'none', typ: 'JWT' }),
    segment({
      iss: 'uat-local-jatelindo-fake',
      jti: randomUUID(),
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
    }),
    'not-a-signature',
  ].join('.');
}

let sequence = 0;

/**
 * Their reference, which we invent. `JPA` matches the real shape.
 *
 * The counter is there for the reason `nextProviderReference` records: the
 * store is keyed on this value, and two transfers in the same millisecond
 * would otherwise have one silently overwrite the other.
 */
export function nextJpaReference(): string {
  sequence += 1;
  return `JPA-${Date.now()}-${sequence.toString().padStart(4, '0')}`;
}

/** Their transaction number, which the client stores as `bankReference`. */
export function jatelindoTransactionNumber(jpaReference: string): string {
  return `TRX${jpaReference}`;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
