import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';

/**
 * How long the fake's token claims to live.
 *
 * Must comfortably exceed `MOTIONPAY_TOKEN_SKEW_SECONDS` (300 in
 * `.env.test`): the client caches until `exp - skew`, so a TTL at or below the
 * skew collapses to "already expired" and every request mints again.
 */
export const FAKE_TOKEN_TTL_SECONDS = 30 * 60;

/**
 * An unsigned JWT carrying a real `exp`, rather than the opaque
 * `fake-${randomUUID()}` the design sketch suggests.
 *
 * `MotionPayQrisAuthService.resolveExpiry` derives its cache deadline from the
 * token's own `exp` claim via `readJwtExpSeconds`, and when it cannot read one
 * it warns and declines to cache - deliberately, since a redundant token call
 * is cheap and a stale token is an outage. An opaque string therefore works,
 * but it makes every single upstream call mint a new token and the token cache
 * and its Redis `getOrRefresh` path are never exercised at all. Since
 * exercising the real client's code is the entire point of this harness, the
 * fake hands back something the client can actually read.
 *
 * `alg: none` and a literal signature: nothing verifies this, and it should be
 * obvious at a glance that nothing could.
 */
export function mintFakeToken(
  ttlSeconds: number = FAKE_TOKEN_TTL_SECONDS,
): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const segment = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  return [
    segment({ alg: 'none', typ: 'JWT' }),
    segment({
      iss: 'uat-local-motionpay-fake',
      jti: randomUUID(),
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
    }),
    'not-a-signature',
  ].join('.');
}

/**
 * A timestamp the client reads back as the instant it actually is.
 *
 * The provider's docs and its sandbox disagree about what the printed offset
 * means - that is the whole subject of `motionpay.helper.ts` - and the client
 * resolves it with `DEFAULT_TIMESTAMP_MODE = 'offset'`, meaning it trusts
 * whatever offset is printed. So the fake prints the Jakarta wall clock
 * against a real `+07:00`, which is true under that reading and leaves
 * `assertTimestampMode` quiet.
 *
 * The sketch's `wib(new Date())` - WIB wall clock labelled `+00:00`, imitating
 * the provider's own quirk - would make the client log a seven-hour skew
 * **error on every create**. Reproducing a provider's bug in the fake only
 * teaches us to ignore the alarm that exists to catch it. Deliberate
 * misbehaviour belongs in the scenario switchboard, where it is asked for.
 */
export function motionPayTimestamp(at: Date = new Date()): string {
  return DateTime.fromJSDate(at)
    .setZone('Asia/Jakarta')
    .toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");
}

let sequence = 0;

/**
 * Their reference, which we invent. `FM-` matches the real shape.
 *
 * The sketch's bare `Date.now()` collides when two creates land in the same
 * millisecond, and the store is keyed on this value - so one transaction would
 * silently overwrite another. The counter makes that impossible within a
 * process, which is the only lifetime the store has.
 */
export function nextProviderReference(): string {
  sequence += 1;
  return `FM-${Date.now()}-${sequence.toString().padStart(4, '0')}`;
}

/** Obviously not a real QR, so it is never mistaken for one. */
export function fakeQrString(providerReference: string): string {
  return `00020101021226FAKEUAT${providerReference}`;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
