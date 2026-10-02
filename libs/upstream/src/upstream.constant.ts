/**
 * Keys under which raw provider payloads are stored in a transaction's
 * `metadata` column.
 *
 * The column is one JSON object keyed by event rather than a single payload, so
 * each stage of a transaction's life keeps its own evidence instead of
 * overwriting the last. A disputed payment is argued from the create response
 * *and* the callback, and the callback arriving must never erase what we sent to
 * make the QR.
 *
 * **Provider-neutral on purpose, and that is why it lives in `libs/upstream`.**
 * The keys name the *event*, not who served it - a bank payout's callback is a
 * bank payout's callback whether MotionPay, Teleanjar or Jatelindo delivered
 * it. Reconciliation reads these by event, so a per-provider set would mean the
 * same question had a different answer per row.
 *
 * Which provider served a transaction is already on the row, in `providerName`.
 *
 * > ⚠️ **Every value must be unique.** They are object keys in one JSON
 * > document, so two names sharing a value silently overwrite each other -
 * > e-wallet evidence filed under a bank label, and whichever wrote last wins.
 * > There is a spec pinning this.
 */
export const METADATA_KEY = {
  QRIS_CREATE: 'QRIS_CREATE',
  QRIS_CREATE_ERROR: 'QRIS_CREATE_ERROR',
  QRIS_CALLBACK: 'QRIS_CALLBACK',
  QRIS_STATUS: 'QRIS_STATUS',

  /** No VA product yet - declared ahead of one so the naming stays uniform. */
  VA_CREATE: 'VA_CREATE',
  VA_CREATE_ERROR: 'VA_CREATE_ERROR',
  VA_CALLBACK: 'VA_CALLBACK',
  VA_STATUS: 'VA_STATUS',

  TRANSFER_BANK_ACCOUNT_INQUIRY: 'TRANSFER_BANK_ACCOUNT_INQUIRY',
  TRANSFER_BANK_PAYMENT: 'TRANSFER_BANK_PAYMENT',
  TRANSFER_BANK_CREATE_ERROR: 'TRANSFER_BANK_CREATE_ERROR',
  TRANSFER_BANK_CALLBACK: 'TRANSFER_BANK_CALLBACK',
  TRANSFER_BANK_STATUS: 'TRANSFER_BANK_STATUS',

  TRANSFER_EWALLET_ACCOUNT_INQUIRY: 'TRANSFER_EWALLET_ACCOUNT_INQUIRY',
  TRANSFER_EWALLET_PAYMENT: 'TRANSFER_EWALLET_PAYMENT',
  TRANSFER_EWALLET_CREATE_ERROR: 'TRANSFER_EWALLET_CREATE_ERROR',
  TRANSFER_EWALLET_CALLBACK: 'TRANSFER_EWALLET_CALLBACK',
  TRANSFER_EWALLET_STATUS: 'TRANSFER_EWALLET_STATUS',
} as const;
export type METADATA_KEY = (typeof METADATA_KEY)[keyof typeof METADATA_KEY];
