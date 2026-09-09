import {
  AmountType,
  EWalletEnum,
  MoneyType,
  ProviderNameEnum,
  TransactionStatusEnum,
} from '@app/microservice';
import { Static, Type } from '@sinclair/typebox';

/**
 * Validate a beneficiary before money leaves.
 *
 * Payouts are the asymmetric case: a pay-in that fails can be retried, a payout
 * to the wrong account number is gone. One round trip here converts an
 * unrecoverable loss into a 400.
 */
export const UpstreamTransferInquiryRequestSchema = Type.Object({
  systemReference: Type.String(),
  providerName: Type.Enum(ProviderNameEnum),
  bankCode: Type.String(),
  accountNumber: Type.String(),
});
export type UpstreamTransferInquiryRequestDto = Static<
  typeof UpstreamTransferInquiryRequestSchema
>;

export const UpstreamTransferInquiryResponseSchema = Type.Object({
  /**
   * Whether the account exists.
   *
   * A failed lookup is a **normal business outcome**, not an exception - the
   * provider answers HTTP 200 with an empty name. Check this flag; do not rely
   * on the absence of a thrown error.
   */
  valid: Type.Boolean(),
  bankCode: Type.String(),
  accountNumber: Type.String(),
  /** Empty when the lookup failed. */
  accountHolderName: Type.String(),
  message: Type.String(),
  metadata: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamTransferInquiryResponseDto = Static<
  typeof UpstreamTransferInquiryResponseSchema
>;

export const UpstreamTransferRequestSchema = Type.Object({
  /**
   * Sent to the provider as their `external_id`.
   *
   * Our `systemReference`, **not** the merchant's reference - unlike QRIS. The
   * transfer status endpoint is keyed by this value, so it has to be unique
   * across every merchant we have; a merchant reference is only unique within
   * one merchant and two merchants both using `PAYOUT-001` would collide at the
   * provider.
   */
  systemReference: Type.String(),
  providerName: Type.Enum(ProviderNameEnum),
  merchantReference: Type.String(),
  amount: AmountType,
  bankCode: Type.String(),
  accountNumber: Type.String(),
  accountHolderName: Type.Union([Type.String(), Type.Null()]),
  note: Type.String(),
});
export type UpstreamTransferRequestDto = Static<
  typeof UpstreamTransferRequestSchema
>;

export const UpstreamTransferResponseSchema = Type.Object({
  providerReference: Type.String(),
  /**
   * Almost always `PENDING`.
   *
   * A payout is accepted and settled asynchronously - MotionPay's happy path on
   * create is `0002 / On Process`, not success. Treating anything but an
   * outright rejection as final would mark real payouts failed.
   */
  status: Type.Enum(TransactionStatusEnum),
  nominal: MoneyType,
  message: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamTransferResponseDto = Static<
  typeof UpstreamTransferResponseSchema
>;

export const UpstreamTransferStatusRequestSchema = Type.Object({
  /** The lookup key. See the note on the request schema above. */
  systemReference: Type.String(),
  providerReference: Type.Union([Type.String(), Type.Null()]),
});
export type UpstreamTransferStatusRequestDto = Static<
  typeof UpstreamTransferStatusRequestSchema
>;

export const UpstreamTransferStatusResponseSchema = Type.Object({
  systemReference: Type.String(),
  providerReference: Type.String(),
  status: Type.Enum(TransactionStatusEnum),
  message: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamTransferStatusResponseDto = Static<
  typeof UpstreamTransferStatusResponseSchema
>;

/**
 * A provider payout notification, normalised.
 *
 * Mirrors `UpstreamWebhookQrisDto` deliberately - same boundary, same rules -
 * with one structural difference: a payout is found by **our** reference, not
 * the provider's, because that is what their status endpoint is keyed by and
 * what their callback echoes back.
 *
 * Carries no transport detail. The origin check belongs to the adapter that
 * understands that provider's authentication, and has already happened.
 */
export const UpstreamWebhookTransferSchema = Type.Object({
  /** Our reference, echoed by the provider. **The lookup key.** */
  systemReference: Type.String(),
  /** The provider's identifier. Corroboration, and stored for reconciliation. */
  providerReference: Type.Union([Type.String(), Type.Null()]),
  providerName: Type.Enum(ProviderNameEnum),
  status: Type.Enum(TransactionStatusEnum),
  message: Type.Union([Type.String(), Type.Null()]),
  /** The raw provider payload, keyed by event, for the transaction's metadata. */
  metadata: Type.Record(Type.String(), Type.Unknown()),
  /** The raw body exactly as received, for the webhook log. */
  rawPayload: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamWebhookTransferDto = Static<
  typeof UpstreamWebhookTransferSchema
>;

/* -------------------------------------------------------------------------- */
/*  E-wallet payout                                                            */
/*                                                                             */
/*  A second route to the same destination. Providers reach wallets through    */
/*  their bill-payment rails as well as their transfer rails, and the former   */
/*  is materially cheaper - so the *payment method* decides the route:         */
/*  TRANSFERBANK goes out over transfer, TRANSFEREWALLET over the biller.      */
/*                                                                             */
/*  Kept as its own contract rather than folded into the transfer DTOs because */
/*  the addressing is genuinely different: a wallet is reached by wallet plus  */
/*  phone number, not by bank code plus account number, and the biller leg is  */
/*  two calls rather than one.                                                 */
/* -------------------------------------------------------------------------- */

export const UpstreamEWalletTopupRequestSchema = Type.Object({
  /**
   * Sent as the provider's `external_id` on the **inquiry** leg. The payment
   * leg derives its own from this, because the biller spec requires the two to
   * differ.
   */
  systemReference: Type.String(),
  providerName: Type.Enum(ProviderNameEnum),
  merchantReference: Type.String(),
  amount: AmountType,
  eWallet: Type.Enum(EWalletEnum),
  /** The wallet's phone number. Stored as `recipientAccount`, same as a bank account. */
  accountNumber: Type.String(),
});
export type UpstreamEWalletTopupRequestDto = Static<
  typeof UpstreamEWalletTopupRequestSchema
>;

/**
 * What the inquiry leg discovered.
 *
 * Unlike a bank account inquiry - which only answers "does this exist" - a
 * biller inquiry **creates state at the provider** and discovers the price. The
 * `providerReference` it returns is required by the payment leg, so it has to
 * survive between the two calls.
 */
export const UpstreamEWalletInquiryResponseSchema = Type.Object({
  /** The provider's `transaction_id`. **Payment cannot proceed without it.** */
  providerReference: Type.String(),
  /** Name the wallet resolved to. Empty when the provider does not supply one. */
  accountHolderName: Type.String(),
  productCode: Type.String(),
  productName: Type.String(),
  /** What the customer receives. */
  nominal: MoneyType,
  /** The provider's cut, on top of the nominal. */
  fee: MoneyType,
  /** `nominal + fee + penalty` - what our deposit is actually debited. */
  total: MoneyType,
  metadata: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamEWalletInquiryResponseDto = Static<
  typeof UpstreamEWalletInquiryResponseSchema
>;

export const UpstreamEWalletTopupResponseSchema = Type.Object({
  providerReference: Type.String(),
  /** `202 Pending` is the ordinary outcome; top-ups settle asynchronously. */
  status: Type.Enum(TransactionStatusEnum),
  nominal: MoneyType,
  message: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamEWalletTopupResponseDto = Static<
  typeof UpstreamEWalletTopupResponseSchema
>;
