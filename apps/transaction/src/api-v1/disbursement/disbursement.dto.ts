import { AmountType, TransactionStatusEnum } from '@app/microservice';
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
