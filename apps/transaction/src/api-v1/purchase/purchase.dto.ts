import { AmountType, TransactionStatusEnum } from '@app/microservice';
import { Static, Type } from '@sinclair/typebox';

export const CreateQrisRequestSchema = Type.Object({
  amount: AmountType,
  merchantReference: Type.String(), // partnerReferenceNo (SNAP)
  expireSeconds: Type.Number({ minimum: 600 }), // validityPeriod (SNAP)
});
export type CreateQrisRequestDto = Static<typeof CreateQrisRequestSchema>;

export const CreateQrisResponseSchema = Type.Object({
  responseCode: Type.String(),
  responseMessage: Type.String(),
  serverTime: Type.String(),
  data: Type.Object({
    transactionId: Type.String(),
    systemReference: Type.String(),
    merchantReference: Type.String(),
    status: Type.Enum(TransactionStatusEnum),
    qr: Type.Object({
      qrContent: Type.String(),
      // qrUrl: Type.String(), // For Later use
      expiresAt: Type.String(),
    }),
  }),
  /// Under discussion
  // additionalInfo: Type.Object({
  //   requestId: Type.String(),
  // }),
});
