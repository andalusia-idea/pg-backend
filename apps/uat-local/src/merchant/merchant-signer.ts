import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * The merchant half of the HMAC scheme, written out by hand.
 *
 * Deliberately **not** importing `@app/signature`. A fake merchant signing
 * with our own helper cannot catch a bug in our own helper: both sides would
 * build the same wrong canonical string and agree with each other. The rules
 * here are transcribed from `docs/merchant-signature.md`, and the way to keep
 * them in step is to read that document, never to import from it.
 *
 * Transcribed rules, all of which a merchant gets wrong at least once:
 * - canonical string is `METHOD:endpoint:nonce:bodyHash:timestampIso`;
 * - `endpoint` is the path as it will arrive in `req.url`, query string
 *   included - transaction sets no global prefix, so nothing is stripped;
 * - `bodyHash` is the SHA-256 of the **exact bytes sent**, so the body is
 *   serialised once here and that same string is what the caller must send;
 * - the MAC is HMAC-SHA512 as lowercase hex, 128 characters;
 * - a POST must carry `content-type: application/json` even with no payload.
 */

/** What to send, and the four headers that authenticate it. */
export interface SignedRequest {
  /** The exact body bytes the signature was computed over. */
  body: string;
  headers: Record<string, string>;
}

export interface SignRequestInput {
  clientId: string;
  secretKey: string;
  method: 'GET' | 'POST';
  /** Path as it will appear in `req.url`, query string included. */
  endpoint: string;
  /** Serialised for a POST; `{}` suits an endpoint that reads no body. */
  payload?: unknown;
  /** Injectable so a replay or clock-skew case can pin one value. */
  timestampIso?: string;
  nonce?: string;
}

const sha256Hex = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

/**
 * A nonce from the allowed alphabet (`^[A-Za-z0-9._~-]{8,128}$`), new on every
 * call because the server remembers them. Hex rather than a UUID so it cannot
 * contain a colon even by accident - the canonical string is colon-delimited,
 * so a colon inside a field would let two different requests produce one
 * string to sign.
 */
const newNonce = (): string => randomBytes(16).toString('hex');

/**
 * An ISO-8601 timestamp **with** an offset, which `toISOString` gives as `Z`.
 * Without one the server would resolve it against its own local zone, so the
 * guard rejects it outright.
 */
const nowIso = (): string => new Date().toISOString();

export const signRequest = ({
  clientId,
  secretKey,
  method,
  endpoint,
  payload,
  timestampIso = nowIso(),
  nonce = newNonce(),
}: SignRequestInput): SignedRequest => {
  const body = method === 'POST' ? JSON.stringify(payload ?? {}) : '';

  /// Hashing `''` for a bodiless request reproduces EMPTY_BODY_SHA256 rather
  /// than copying it across, which is the point of signing by hand: a wrong
  /// constant on our side would show up here as a mismatch.
  const bodyHash = sha256Hex(body);

  const canonical = [method, endpoint, nonce, bodyHash, timestampIso].join(':');

  const signature = createHmac('sha512', secretKey)
    .update(canonical)
    .digest('hex');

  return {
    body,
    headers: {
      'x-client-id': clientId,
      'x-timestamp': timestampIso,
      'x-nonce': nonce,
      'x-signature': signature,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
  };
};
