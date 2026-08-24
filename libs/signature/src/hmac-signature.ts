import {
  randomUUID,
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
} from 'crypto';

export const generateClientId = (): string => {
  const uuidv4 = randomUUID();
  return uuidv4;
};

/**
 * 32 bytes of entropy as lowercase hex.
 *
 * Handed to the merchant as-is and used as the HMAC key as-is - no decoding
 * step. Every HMAC API accepts a string key directly (`hash_hmac` in PHP,
 * `createHmac` in Node, `hmac.new` in Python), so requiring merchants to
 * decode first would add a step whose only failure mode is a silent
 * "invalid signature".
 */
export const generateSecretKey = (): string => {
  const secretKey = randomBytes(32).toString('hex');
  return secretKey;
};

export const generateNonce = (): string => {
  const uuidv4 = randomUUID();
  return uuidv4;
};

/**
 * SHA-256 of the empty string - the body hash for a request with no body.
 */
export const EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/**
 * Lowercase hex SHA-256 of whatever bytes are passed in.
 *
 * Each side of the exchange decides what to feed it, and the difference
 * matters:
 *
 * - The **merchant** hashes the exact string it is about to send, typically
 *   `sha256Hex(JSON.stringify(body))`.
 * - The **server** hashes the raw bytes it received, never a re-serialisation
 *   of the parsed body. `JSON.parse` then `JSON.stringify` is not a round
 *   trip - it reorders integer-like keys, drops trailing zeros (`1.50` ->
 *   `1.5`), expands exponents (`1e3` -> `1000`) and strips whitespace, so
 *   re-serialising would hash something the merchant never sent.
 */
export const sha256Hex = (input: string | Buffer): string =>
  createHash('sha256').update(input).digest('hex');

interface IBuildCanonical {
  httpMethod: 'GET' | 'POST';
  endpoint: string;
  nonce: string;
  /** Lowercase hex SHA-256 of the body - see {@link sha256Hex}. */
  bodyHash: string;
  timestampIso: string;
}

/**
 * The string to sign.
 *
 * Field order follows SNAP's symmetric signature with the nonce standing in
 * for SNAP's access token, since this API issues no tokens.
 *
 * The `:` delimiter is safe only while no field can contain a colon. Method
 * and body hash cannot by construction, and the timestamp is last - so the
 * guard must reject any nonce that is not a UUID or hex string, otherwise two
 * different requests could produce one canonical string.
 */
export const buildCanonical = ({
  httpMethod,
  endpoint,
  nonce,
  bodyHash,
  timestampIso,
}: IBuildCanonical): string =>
  [httpMethod, endpoint, nonce, bodyHash, timestampIso].join(':');

/**
 * ISO-8601 date-time with a **mandatory** UTC offset (`Z` or `±HH:MM`).
 *
 * The offset is not optional styling. `new Date('2026-08-23T10:15:30')`
 * resolves against the *server's* local zone, so the same request would be
 * read as WIB on one host and UTC on another - a merchant's requests would
 * start failing purely because a container moved. Rejecting the string
 * outright turns that into a clear format error instead.
 *
 * `new Date` is also far too permissive to rely on alone: it accepts '2026'
 * and 'Aug 23 2026'. Fractional seconds are allowed 1-9 digits so that
 * serialisers emitting microseconds (Python) are accepted alongside those
 * emitting milliseconds (JavaScript).
 */
const ISO_8601_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

interface IIsTimestampWithin {
  timestampIso: string;
  toleranceSeconds: number;
  /** Epoch milliseconds. Injectable so tests need not depend on wall time. */
  now?: number;
}

/**
 * Whether a request timestamp is close enough to now to be accepted.
 *
 * Compares in both directions - a merchant's clock can run fast as easily as
 * slow - so the accepted band is `toleranceSeconds` either side, i.e. twice
 * that wide in total. Any nonce store must therefore retain entries for at
 * least that full span, or a request becomes replayable once its nonce
 * expires while its timestamp is still valid.
 */
export const isTimestampWithin = ({
  timestampIso,
  toleranceSeconds,
  now = Date.now(),
}: IIsTimestampWithin): boolean => {
  if (!ISO_8601_WITH_OFFSET.test(timestampIso)) return false;

  // The regex admits impossible dates such as month 13, which Date rejects.
  const requestedAt = new Date(timestampIso).getTime();
  if (Number.isNaN(requestedAt)) return false;

  return Math.abs(now - requestedAt) <= toleranceSeconds * 1000;
};

interface IBuildSignature {
  secretKey: string;
  canonical: string;
}
/// Message Authentication Code (MAC)
export const buildSignature = ({ secretKey, canonical }: IBuildSignature) => {
  /// Message authenticatio Code (MAC)
  const signature = createHmac('sha512', secretKey)
    .update(canonical)
    .digest('hex');
  return signature;
};

interface IVerifySignature {
  secretKey: string;
  canonical: string;
  signatureReceived: string;
}
export const verifySignature = ({
  secretKey,
  canonical,
  signatureReceived,
}: IVerifySignature): boolean => {
  const signatureExpected = buildSignature({ secretKey, canonical });

  const bufferSignatureExpected = Buffer.from(signatureExpected, 'hex');
  const bufferSignatureReceived = Buffer.from(signatureReceived, 'hex');

  // timingSafeEqual THROWS on length mismatch — must guard first
  if (bufferSignatureExpected.length !== bufferSignatureReceived.length)
    return false;

  return timingSafeEqual(bufferSignatureExpected, bufferSignatureReceived);
};
