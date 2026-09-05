import { AmountType, TransactionStatusEnum } from '@app/microservice';
import { Static, Type } from '@sinclair/typebox';

export const CreateQrisRequestSchema = Type.Object(
  {
    amount: AmountType,
    /**
     * partnerReferenceNo (SNAP) - the merchant's own identifier for this order.
     *
     * Unique per merchant, which is what makes a retry safe to detect: sending
     * the same reference twice is answered with a 409 rather than creating a
     * second QR for one order.
     */
    merchantReference: Type.String({ minLength: 1, maxLength: 64 }),
    /**
     * validityPeriod (SNAP), in seconds.
     *
     * Floored to whole minutes downstream, because that is the unit the
     * provider accepts - so 650 is honoured as 600, and the `expiresAt` we
     * return reflects the floored value rather than what was asked for.
     */
    expireSeconds: Type.Integer({ minimum: 600, maximum: 86_400 }),
  },
  { additionalProperties: false },
);
export type CreateQrisRequestDto = Static<typeof CreateQrisRequestSchema>;

/**
 * The `data` payload only.
 *
 * `responseCode` / `responseMessage` / `serverTime` are added by
 * {@link MerchantResponseInterceptor}, so a handler must never build them
 * itself - two sources for one envelope is how they drift apart.
 */
export const CreateQrisDataSchema = Type.Object({
  transactionId: Type.String(), // systemReference
  merchantReference: Type.String(),
  status: Type.Enum(TransactionStatusEnum),
  qr: Type.Object({
    qrString: Type.String(),
    // qrUrl: Type.String(), // For Later use
    expiresAt: Type.String(),
  }),
});
export type CreateQrisDataDto = Static<typeof CreateQrisDataSchema>;

/** Documentation of the full envelope the merchant receives. */
export const CreateQrisResponseSchema = Type.Object({
  responseCode: Type.String(),
  responseMessage: Type.String(),
  serverTime: Type.String(),
  data: CreateQrisDataSchema,
  /// Under discussion
  // additionalInfo: Type.Object({
  //   requestId: Type.String(),
  // }),
});
export type CreateQrisResponseDto = Static<typeof CreateQrisResponseSchema>;

export const WebhookPayinSchema = Type.Object({
  transactionId: Type.String(), // systemReference
  merchantReference: Type.String(),
  amount: AmountType,
  netAmount: AmountType,
  fee: AmountType,
  status: Type.Enum(TransactionStatusEnum),
  /** ISO 8601 UTC. Null when the transaction was not paid. */
  paidAt: Type.Union([Type.String(), Type.Null()]),
});
export type WebhookPayinDto = Static<typeof WebhookPayinSchema>;
