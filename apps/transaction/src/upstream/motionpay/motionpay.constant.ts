export const MOTIONPAY_ENDPOINT = {
  TOKEN: '/priv/v1/pg/token',
  CREATE_QRIS_PAYMENT: '/payment/api/v1/qris/payment',
  /** Append the provider's `transaction_id` (the `FM-…` value), not our code. */
  QRIS_PAYMENT_STATUS: '/payment/api/v1/qris/payment-status',
} as const;

/**
 * Envelope `status.code` values.
 *
 * Note the asymmetry, which is in the provider's spec and not a mistake here:
 * the token endpoint signals success with 200, the payment endpoints with 0.
 * A single shared "is OK" check across all three would be wrong.
 */
export const MOTIONPAY_STATUS_CODE = {
  TOKEN_OK: 200,
  PAYMENT_OK: 0,
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  UNPROCESSABLE: 422,
} as const;

/** Wire values of `data.status`. The provider has no EXPIRED state. */
export const MOTIONPAY_TRANSACTION_STATUS = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;

export const MOTIONPAY_QR_TYPE = {
  DYNAMIC: 'QRIS_DYNAMIC',
  STATIC: 'QRIS_STATIC',
} as const;

/** Documented bounds for `amount`, in whole rupiah. */
export const MOTIONPAY_AMOUNT = {
  MIN: 1_000,
  MAX: 10_000_000,
} as const;

/** Documented minimum for `session_time`, in minutes. */
export const MOTIONPAY_MIN_SESSION_TIME_MINUTES = 1;

/**
 * Documented max length of `external_id` / `terminal_id`.
 *
 * Flagged as an open question in docs/upstream/motionpay.md: the provider's own
 * samples exceed this (`"20c67336-dcea-42d8-a"` is 20 chars), and our
 * transaction code format does not fit in 16. We validate rather than truncate
 * — silently cutting a correlation key would break callback matching.
 */
export const MOTIONPAY_EXTERNAL_ID_MAX_LENGTH = 16;
