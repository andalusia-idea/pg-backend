import {
  AmountType,
  ProviderNameEnum,
  TransactionStatusEnum,
} from '@app/microservice';
import { Static, Type } from '@sinclair/typebox';

export const PurchaseUpstreamRequestSchema = Type.Object({
  systemReference: Type.String(),
  userId: Type.Number(),
  providerName: Type.Enum(ProviderNameEnum),
  merchantReference: Type.String(),
  amount: AmountType,
  expireSeconds: Type.Number(),
});
export type PurchaseUpstreamRequestDto = Static<
  typeof PurchaseUpstreamRequestSchema
>;

export const PurchaseUpstreamResponseSchema = Type.Object({
  providerReference: Type.String(),
  qrString: Type.String(),
  nominal: Type.String(),
  expiresAt: Type.String(),
  status: Type.Enum(TransactionStatusEnum),
  message: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
});
export type PurchaseUpstreamResponseDto = Static<
  typeof PurchaseUpstreamResponseSchema
>;
