/**
 * Business failures a merchant-facing transaction endpoint can return.
 *
 * Separate from {@link MerchantSignatureFailureEnum}: those are cross-cutting
 * (who are you, are you allowed to call at all), these are about one specific
 * transaction attempt. Keeping them apart is what lets the two use different
 * SNAP service codes - `00` for auth, `90`+ for business - so a merchant
 * parsing `responseCode` can tell "re-sign your request" from "fix your
 * payload" without reading the message.
 */
export const TransactionFailureEnum = {
  /** Body failed schema validation - wrong type, bad format, out of range. */
  INVALID_FIELD_FORMAT: 'INVALID_FIELD_FORMAT',
  /** A required field is absent. */
  INVALID_MANDATORY_FIELD: 'INVALID_MANDATORY_FIELD',
  /**
   * Authenticated, but not configured for this payment method / transaction
   * type. Distinct from a signature rejection: their credentials are fine.
   */
  TRANSACTION_NOT_PERMITTED: 'TRANSACTION_NOT_PERMITTED',
  /** `merchantReference` has already been used by this merchant. */
  DUPLICATE_MERCHANT_REFERENCE: 'DUPLICATE_MERCHANT_REFERENCE',
  /** The provider answered, and said no. */
  UPSTREAM_REJECTED: 'UPSTREAM_REJECTED',
  /** The provider did not answer in time. */
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  /** A dependency we own is unreachable - database, config service, Redis. */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  /** Our bug. Never a description of anything the merchant did. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type TransactionFailureEnum =
  (typeof TransactionFailureEnum)[keyof typeof TransactionFailureEnum];
