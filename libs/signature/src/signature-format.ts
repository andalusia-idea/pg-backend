import { SIGNATURE_HEX_LENGTH } from './hmac-signature';

/**
 * Format rules for the merchant signature headers.
 *
 * These live here rather than in the guard so both sides of the exchange -
 * the guard that rejects malformed input and the TCP contract that assumes it
 * was already rejected - are describing one rule, not two that can drift.
 */

export const NONCE_MIN_LENGTH = 8;
export const NONCE_MAX_LENGTH = 128;

/**
 * A nonce may be any unreserved-character string: alphanumerics plus
 * `. _ ~ -` (RFC 3986 "unreserved").
 *
 * That admits UUIDs (`3f2b8c1d-4e5a-...`), plain counters (`00000001`), and
 * merchant-side references (`ORD-000001`) alike.
 *
 * **The one hard requirement is the absence of `:`.** The canonical string is
 * colon-delimited, so a nonce containing one could shift a field boundary and
 * let two different requests produce the same string to sign - a signature for
 * one would then authorise the other. Everything else about this alphabet is
 * conservatism, not necessity: whitespace and control characters are excluded
 * because they have no business in a header value.
 *
 * ⚠️ A nonce must be unique per **attempt**, not per order. Reusing one is
 * rejected as a replay, so an order number makes a poor nonce: a retry of the
 * same order needs a *new* one. Idempotency is `orderId`'s job; the nonce only
 * guarantees a request cannot be replayed.
 */
export const NONCE_PATTERN = new RegExp(
  `^[A-Za-z0-9._~-]{${NONCE_MIN_LENGTH},${NONCE_MAX_LENGTH}}$`,
);

export const isValidNonce = (nonce: string): boolean =>
  NONCE_PATTERN.test(nonce);

/**
 * A signature is exactly {@link SIGNATURE_HEX_LENGTH} hex characters.
 *
 * Case-insensitive because `Buffer.from(str, 'hex')` is; the guard accepts
 * uppercase rather than failing a merchant over presentation.
 */
export const SIGNATURE_PATTERN = new RegExp(
  `^[0-9a-fA-F]{${SIGNATURE_HEX_LENGTH}}$`,
);

export const isValidSignatureFormat = (signature: string): boolean =>
  SIGNATURE_PATTERN.test(signature);
