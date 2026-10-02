import {
  AmountType,
  MoneyType,
  ProviderNameEnum,
  TransactionStatusEnum,
} from '@app/microservice';
import { Static, Type } from '@sinclair/typebox';

export const UpstreamTransferRequestSchema = Type.Object({
  systemReference: Type.String(),
  merchantReference: Type.String(),
  providerName: Type.Enum(ProviderNameEnum),
  amount: AmountType,
  bankCode: Type.String(),
  accountNumber: Type.String(),
  accountHolderName: Type.Union([Type.String(), Type.Null()]),
  note: Type.String(),
  providerReference: Type.Union([Type.String(), Type.Null()]),
});
export type UpstreamTransferRequestDto = Static<
  typeof UpstreamTransferRequestSchema
>;

export const UpstreamTransferAccountInquiryResponseSchema = Type.Object({
  valid: Type.Boolean(),
  bankCode: Type.String(),
  accountNumber: Type.String(),
  accountHolderName: Type.String(),
  message: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  providerReference: Type.Union([Type.String(), Type.Null()]),
});
export type UpstreamTransferAccountInquiryResponseDto = Static<
  typeof UpstreamTransferAccountInquiryResponseSchema
>;

export const UpstreamTransferPaymentResponseSchema = Type.Object({
  providerReference: Type.String(),
  status: Type.Enum(TransactionStatusEnum),
  nominal: MoneyType,
  message: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamTransferPaymentResponseDto = Static<
  typeof UpstreamTransferPaymentResponseSchema
>;

/// Transfer Additional
export const UpstreamTransferStatusRequestSchema = Type.Object({
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

export const UpstreamWebhookTransferSchema = Type.Object({
  systemReference: Type.String(),
  providerReference: Type.Union([Type.String(), Type.Null()]),
  providerName: Type.Enum(ProviderNameEnum),
  status: Type.Enum(TransactionStatusEnum),
  message: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  rawPayload: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamWebhookTransferDto = Static<
  typeof UpstreamWebhookTransferSchema
>;
