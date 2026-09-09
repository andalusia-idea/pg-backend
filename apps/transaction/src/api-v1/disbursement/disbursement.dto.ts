import {
  AmountType,
  EWalletEnum,
  TransactionStatusEnum,
} from '@app/microservice';
import { Static, Type } from '@sinclair/typebox';

export const CreateTransferRequestSchema = Type.Object(
  {
    amount: AmountType,
    /**
     * partnerReferenceNo (SNAP) - the merchant's own identifier for this payout.
     *
     * Unique per merchant, which is what makes a retry safe to detect: sending
     * the same reference twice is answered with a 409 rather than paying the
     * recipient twice.
     */
    merchantReference: Type.String({ minLength: 1, maxLength: 64 }),
    /** Bank or e-wallet code, per the provider's list. */
    bankCode: Type.String({ minLength: 1, maxLength: 16 }),
    accountNumber: Type.String({ minLength: 1, maxLength: 32 }),
    /**
     * Optional. When given it is sent to the provider, but the name we record
     * and return is always the one the **bank** confirmed during inquiry - a
     * merchant's own spelling is not evidence of who owns the account.
     */
    accountHolderName: Type.Optional(Type.String({ maxLength: 128 })),
    note: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { additionalProperties: false },
);
export type CreateTransferRequestDto = Static<
  typeof CreateTransferRequestSchema
>;

/**
 * The `data` payload only - the envelope is added by
 * {@link MerchantResponseInterceptor}.
 *
 * `status` is almost always `PENDING`: payouts settle asynchronously and the
 * final state arrives by callback. A merchant that treats a 200 here as "paid"
 * has misread the contract.
 */
export const CreateTransferDataSchema = Type.Object({
  transactionId: Type.String(), // systemReference
  merchantReference: Type.String(),
  status: Type.Enum(TransactionStatusEnum),
  beneficiary: Type.Object({
    bankCode: Type.String(),
    accountNumber: Type.String(),
    /** As confirmed by the bank during inquiry, not as supplied. */
    accountHolderName: Type.String(),
  }),
});
export type CreateTransferDataDto = Static<typeof CreateTransferDataSchema>;

/**
 * E-wallet payout.
 *
 * A separate endpoint from the bank one because the addressing is genuinely
 * different - a wallet is reached by wallet plus phone number, not bank code
 * plus account number - and folding both into one body would mean fields that
 * are required only sometimes.
 *
 * **Which upstream rail carries it is not the merchant's concern.** Providers
 * reach wallets through both their transfer and their bill-payment APIs at
 * different prices; picking the cheaper one is our margin decision, and
 * exposing it here would mean we could not change it without a merchant-side
 * change.
 */
export const CreateTransferEWalletRequestSchema = Type.Object(
  {
    amount: AmountType,
    /** Unique per merchant. Sending it twice is a 409, not a second payout. */
    merchantReference: Type.String({ minLength: 1, maxLength: 64 }),
    eWallet: Type.Enum(EWalletEnum),
    /**
     * The wallet's registered phone number.
     *
     * Named `accountNumber` to match the bank endpoint: it is the same thing -
     * the identifier of the destination - and calling it something else would
     * mean every report and reconciliation join had to know which endpoint a
     * row came from before it could find where the money went.
     */
    accountNumber: Type.String({ minLength: 1, maxLength: 16 }),
    note: Type.Optional(Type.String({ maxLength: 128 })),
  },
  { additionalProperties: false },
);
export type CreateTransferEWalletRequestDto = Static<
  typeof CreateTransferEWalletRequestSchema
>;

/**
 * `data` payload for an e-wallet payout.
 *
 * No `accountHolderName` guarantee: unlike a bank transfer, where inquiry
 * returns the bank-confirmed holder, a wallet top-up may resolve no name at
 * all. It is returned when the provider supplies one and empty otherwise
 * rather than being invented.
 */
export const CreateTransferEWalletDataSchema = Type.Object({
  transactionId: Type.String(),
  merchantReference: Type.String(),
  status: Type.Enum(TransactionStatusEnum),
  beneficiary: Type.Object({
    eWallet: Type.Enum(EWalletEnum),
    accountNumber: Type.String(),
    accountHolderName: Type.String(),
  }),
});
export type CreateTransferEWalletDataDto = Static<
  typeof CreateTransferEWalletDataSchema
>;

/** Documentation of the full envelope the merchant receives. */
export const CreateTransferResponseSchema = Type.Object({
  responseCode: Type.String(),
  responseMessage: Type.String(),
  serverTime: Type.String(),
  data: CreateTransferDataSchema,
});
export type CreateTransferResponseDto = Static<
  typeof CreateTransferResponseSchema
>;

/** What we POST to the merchant's registered payout webhook URL. */
export const WebhookPayoutSchema = Type.Object({
  transactionId: Type.String(), // systemReference
  merchantReference: Type.String(),
  amount: AmountType,
  netAmount: AmountType,
  fee: AmountType,
  status: Type.Enum(TransactionStatusEnum),
  beneficiary: Type.Object({
    bankCode: Type.String(),
    accountNumber: Type.String(),
    accountHolderName: Type.String(),
  }),
  /** ISO 8601 UTC. Null when the payout did not complete. */
  paidAt: Type.Union([Type.String(), Type.Null()]),
});
export type WebhookPayoutDto = Static<typeof WebhookPayoutSchema>;
