/**
 * Why a merchant signature was rejected.
 *
 * Every rejection is an HTTP 401 to the merchant; this code is what makes the
 * failure diagnosable. Collapsing them into one opaque "invalid signature" is
 * the top integration-support cost in every payment API - a merchant whose
 * clock drifted three minutes needs to see that, not a crypto error.
 *
 * None of these leak anything useful to an attacker: they already know
 * whether they hold a valid secret.
 */
export const MerchantSignatureFailureEnum = {
  /** One of the four required headers was absent. */
  MISSING_HEADER: 'MISSING_HEADER',
  /**
   * `X-Signature` was not the expected length or not hex.
   *
   * Also the code a merchant sees if they implemented the wrong algorithm:
   * digest length identifies it (SHA-256 gives 64 hex, SHA-512 gives 128), so
   * the error message should name both the expected length and the algorithm.
   */
  MALFORMED_SIGNATURE: 'MALFORMED_SIGNATURE',
  /** `X-Nonce` was not a UUID or hex string - see the delimiter note in the design doc. */
  MALFORMED_NONCE: 'MALFORMED_NONCE',
  /** `X-Timestamp` had no UTC offset, was unparseable, or fell outside the window. */
  TIMESTAMP_SKEW: 'TIMESTAMP_SKEW',
  /** No merchant signature row matches the supplied `X-Client-Id`. */
  UNKNOWN_CLIENT: 'UNKNOWN_CLIENT',
  /** The client exists but its status is not ACTIVE. */
  CLIENT_SUSPENDED: 'CLIENT_SUSPENDED',
  /** The MAC did not match, under either the current or the previous secret. */
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  /** This nonce was already used inside the replay window. */
  REPLAYED_NONCE: 'REPLAYED_NONCE',
  /** Merchant has not yet generated Secret Key at Dashboard */
  SECRET_KEY_NOT_GENERATED: 'SECRET_KEY_NOT_GENERATED',
  /**
   * The signature was valid but the request came from an address outside the
   * merchant's IP allowlist.
   *
   * Only reachable *after* the signature verifies, which is what makes it a
   * high-fidelity alarm: it means someone holding the merchant's actual secret
   * called from an unlisted address. Worth alerting on - `clientId` is not a
   * secret, but `secretKey` is.
   */
  IP_NOT_ALLOWED: 'IP_NOT_ALLOWED',
} as const;
export type MerchantSignatureFailureEnum =
  (typeof MerchantSignatureFailureEnum)[keyof typeof MerchantSignatureFailureEnum];
