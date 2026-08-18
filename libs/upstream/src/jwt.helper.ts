/**
 * Read the `exp` claim (epoch seconds) out of a JWT without verifying it.
 *
 * Deliberately unverified: this is only used to decide how long *we* may cache
 * a token an upstream just handed us over TLS. It is not an authorization
 * decision, so there is no signature to check — we are not trusting the claim,
 * only using it to avoid reusing a token past its life.
 *
 * Returns `null` when the token is not a JWT or carries no numeric `exp`, so
 * callers can fall back to not caching rather than guessing a lifetime.
 */
export function readJwtExpSeconds(token: string): number | null {
  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return null;

    const payload: unknown = JSON.parse(
      Buffer.from(payloadSegment, 'base64url').toString('utf8'),
    );

    if (typeof payload !== 'object' || payload === null || !('exp' in payload)) {
      return null;
    }

    const exp = (payload as { exp: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}
