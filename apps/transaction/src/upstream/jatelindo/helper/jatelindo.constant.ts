import { EWalletEnum, TransactionStatusEnum } from '@app/microservice';

export const JATELINDO_ENDPOINT = {
  /// Transfer
  LOGIN: '/Host/Transfer/Session/Login',
  BALANCE_INQUIRY: '/Host/Transfer/Account/BalanceInquiry',
  INQUIRY: '/Host/Transfer/Transaction/Inquiry',
  SINGLE_TRANSFER: '/Host/Transfer/Transaction/SingleTransfer',
  TRANSACTION_STATUS: '/Host/Transfer/Transaction/Status',
};

export const JATELINDO_RESPONSE_CODE = {
  PROCESSED: 'A00',
  REQUESTED: 'A01',
  DUPLICATE_TRANSACTION: 'P16',
  TRANSACTION_FAILED: 'T40',
  TRANSACTION_BLOCKED: 'T40',
  INACTIVE_ACCOUNT: 'S14',
  TRANSACTION_AMOUNT_ABOVE_LIMIT: 'T18',
  TRANSACTION_REJECTED: 'T40',
  TRANSACTION_AMOUNT_BELOW_LIMIT: 'T16',
  INVALID_ACCOUNT: 'S14',
  UNKNOWN_ERROR: 'E99',
  TIMEOUT: 'E18',
  UNAUTHORIZED_ACCESS: 'A90',
  NO_TRANSACTION: 'S84',
  /// TODO complete the rest
} as const;
export type JATELINDO_RESPONSE_CODE =
  (typeof JATELINDO_RESPONSE_CODE)[keyof typeof JATELINDO_RESPONSE_CODE];

/**
 * Response code to our transaction status, per the spec's own table.
 *
 * **The column that matters is "Need Check Status".** Three codes carry `Y`, and
 * the spec calls their status `SUSPECT` - Jatelindo is saying it cannot confirm
 * the outcome and a status call is required. Those must become `PENDING`:
 *
 * - `A01 REQUESTED` - the normal response to an accepted transfer
 * - `E99 UNKNOWN_ERROR`
 * - `E18 TIMEOUT`
 *
 * **Never a terminal state for those.** Marking a SUSPECT payout FAILED,
 * CANCELLED or EXPIRED asserts something the provider has explicitly said it
 * does not know - and a merchant told their payout failed will retry, paying the
 * recipient twice. `PENDING` is the state that means "unresolved, poll it", which
 * is exactly what `Need Check = Y` asks for.
 *
 * Nothing maps to CANCELLED or EXPIRED: Jatelindo has neither concept for a
 * payout. Every `Need Check = N` code is a verified FAILED.
 *
 * Typed as an exhaustive record so a new response code is a compile error here
 * rather than silently taking a default. Table: docs/upstream/jatelindo.md §4.
 */
const JATELINDO_STATUS_BY_RESPONSE_CODE = {
  A00: TransactionStatusEnum.SUCCESS,

  // Need Check = Y / SUSPECT. Outcome unknown, not failed.
  A01: TransactionStatusEnum.PENDING,
  E99: TransactionStatusEnum.PENDING,
  E18: TransactionStatusEnum.PENDING,

  // Need Check = N. The provider answered, and the answer was no.
  P16: TransactionStatusEnum.FAILED,
  T40: TransactionStatusEnum.FAILED,
  T16: TransactionStatusEnum.FAILED,
  T18: TransactionStatusEnum.FAILED,
  S14: TransactionStatusEnum.FAILED,
  A90: TransactionStatusEnum.FAILED,
  S84: TransactionStatusEnum.FAILED,
} as const satisfies Record<JATELINDO_RESPONSE_CODE, TransactionStatusEnum>;

/**
 * An unrecognised code is treated as unresolved, not as failed.
 *
 * The opposite default would turn any code Jatelindo adds - they have added four
 * since 2024 - into a payout we declare dead without checking. Leaving it PENDING
 * costs a status call; getting it wrong costs a double payment.
 */
export const jatelindoMapperResponseCode = (
  responseCode: JATELINDO_RESPONSE_CODE,
): TransactionStatusEnum =>
  JATELINDO_STATUS_BY_RESPONSE_CODE[responseCode] ??
  TransactionStatusEnum.PENDING;

/**
 * Our `bankCode` to Jatelindo's `channelId`.
 *
 * **`channelId` is numeric, for e-wallets as much as for banks.** The e-wallet
 * codes sit in a 90x block and were added in spec v1.6; sending the wallet's
 * *name* is rejected. See docs/upstream/jatelindo.md §3.
 *
 * The two numbering schemes are unrelated: ours is the Indonesian clearing code
 * (`014` = BCA), Jatelindo's is its own sequence running to 142. There is no
 * formula between them - every destination needs a row here, and a missing row
 * means `JATELINDO_CHANNEL[bankCode]` is `undefined`, which the signature then
 * renders as an empty `channelId=` and the provider refuses.
 *
 * Note LinkAja is absent from Jatelindo's list entirely, so a merchant routed
 * here cannot reach it even though MotionPay can.
 */
export const JATELINDO_CHANNEL = {
  // E-wallets. Spec v1.6, "List Channel Transfer".
  [EWalletEnum.DANA]: '901',
  [EWalletEnum.SHOPEEPAY]: '902',
  [EWalletEnum.GOPAY]: '903',
  [EWalletEnum.OVO]: '904',

  // Banks. 2 of 142 mapped.
  '013': '2', // PT. BANK PERMATA Tbk.
  '008': '3', // PT. BANK MANDIRI Tbk.
  /// TODO complete the rest - the full table is in the spec, transcribed
  /// partially in docs/upstream/jatelindo.md §3.
} as const;
