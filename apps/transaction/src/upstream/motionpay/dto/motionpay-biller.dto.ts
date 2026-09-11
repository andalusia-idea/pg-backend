import { Static, Type } from '@sinclair/typebox';
import { MOTIONPAY_BILLER_EXTERNAL_ID_MAX_LENGTH } from '../helper';

const NominalType = Type.String({
  pattern: '^\\d+(\\.\\d{1,2})?$',
  minLength: 1,
  maxLength: 16,
});

/// AUTH
export const MotionPayBillerTokenRequestSchema = Type.Object(
  {
    client_key: Type.String({ minLength: 1 }),
    server_key: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type MotionPayBillerTokenRequestDto = Static<
  typeof MotionPayBillerTokenRequestSchema
>;

export const MotionPayBillerTokenResponseSchema = Type.Object({
  status: Type.Number(),
  message: Type.String(),
  description: Type.String(),
  data: Type.Union([
    Type.Null(),
    Type.Object({ token: Type.String({ minLength: 1 }) }),
  ]),
});
export type MotionPayBillerTokenResponseDto = Static<
  typeof MotionPayBillerTokenResponseSchema
>;

/// Inquiry Prepaid
export const MotionPayBillerInquiryPrepaidRequestSchema = Type.Object(
  {
    external_id: Type.String({
      minLength: 1,
      maxLength: MOTIONPAY_BILLER_EXTERNAL_ID_MAX_LENGTH,
    }),
    product_code: Type.String({ minLength: 1, maxLength: 7 }),
    customer_id: Type.String({ minLength: 1, maxLength: 16 }),
    nominal: Type.Union([Type.Null(), NominalType]),
  },
  { additionalProperties: false },
);
export type MotionPayBillerInquiryPrepaidRequestDto = Static<
  typeof MotionPayBillerInquiryPrepaidRequestSchema
>;

export const MotionPayBillerInquiryPrepaidResponseSchema = Type.Object({
  status: Type.Number(),
  message: Type.String(),
  description: Type.String(),
  data: Type.Union([
    Type.Null(),
    Type.Object({}),
    Type.Object({
      external_id: Type.String({
        minLength: 1,
        maxLength: MOTIONPAY_BILLER_EXTERNAL_ID_MAX_LENGTH,
      }),
      transaction_id: Type.String({ minLength: 1, maxLength: 64 }),
      product_code: Type.String({ minLength: 1, maxLength: 7 }),
      product_name: Type.String({ minLength: 1, maxLength: 150 }),
      customer_id: Type.String({ minLength: 1, maxLength: 16 }),
      amount: NominalType,
      fee: NominalType,
      penalty: NominalType,
      total: NominalType,
      customer_name: Type.Union([Type.Null(), Type.String()]),
      tarif_daya: Type.Union([Type.Null(), Type.String()]),
      jumlah_kwh: Type.Union([Type.Null(), Type.String()]),
      serial_number: Type.Union([Type.Null(), Type.String()]),
    }),
  ]),
});
export type MotionPayBillerInquiryPrepaidResponseDto = Static<
  typeof MotionPayBillerInquiryPrepaidResponseSchema
>;

/// Payment Prepaid
export const MotionPayBillerPaymentPrepaidRequestSchema = Type.Object(
  {
    external_id: Type.String({
      minLength: 1,
      maxLength: MOTIONPAY_BILLER_EXTERNAL_ID_MAX_LENGTH,
    }),
    transaction_id: Type.String({ minLength: 1, maxLength: 64 }),
    product_code: Type.String({ minLength: 1, maxLength: 7 }),
    customer_id: Type.String({ minLength: 1, maxLength: 16 }),
  },
  { additionalProperties: false },
);
export type MotionPayBillerPaymentPrepaidRequestDto = Static<
  typeof MotionPayBillerPaymentPrepaidRequestSchema
>;

export const MotionPayBillerPaymentPrepaidResponseSchema = Type.Object({
  status: Type.Number(),
  message: Type.String(),
  description: Type.String(),
  data: Type.Union([
    Type.Null(),
    Type.Object({}),
    Type.Object({
      external_id: Type.String({
        minLength: 1,
        maxLength: MOTIONPAY_BILLER_EXTERNAL_ID_MAX_LENGTH,
      }),
      transaction_id: Type.String({ minLength: 1, maxLength: 64 }),
      product_code: Type.String({ minLength: 1, maxLength: 7 }),
      product_name: Type.String({ minLength: 1, maxLength: 150 }),
      customer_id: Type.String({ minLength: 1, maxLength: 16 }),
      amount: NominalType,
      fee: NominalType,
      penalty: NominalType,
      total: NominalType,
      customer_name: Type.Union([Type.Null(), Type.String()]),
      tarif_daya: Type.Union([Type.Null(), Type.String()]),
      jumlah_kwh: Type.Union([Type.Null(), Type.String()]),
      serial_number: Type.Union([Type.Null(), Type.String()]),
    }),
  ]),
});
export type MotionPayBillerPaymentPrepaidResponseDto = Static<
  typeof MotionPayBillerPaymentPrepaidResponseSchema
>;

/// Balance Check
export const MotionPayBillerBalanceResponseSchema = Type.Object({
  status: Type.Number(),
  message: Type.String(),
  description: Type.String(),
  data: Type.Union([
    Type.Null(),
    Type.Object({}),
    Type.Object({
      merchant_id: Type.String(),
      balance: NominalType,
      currency: Type.String(),
      checked_at: Type.String(), // ISO 8601 format
    }),
  ]),
});
export type MotionPayBillerBalanceResponseDto = Static<
  typeof MotionPayBillerBalanceResponseSchema
>;

/// Status Check
export const MotionPayBillerStatusRequestSchema = Type.Object(
  {
    external_id: Type.String({
      minLength: 1,
      maxLength: MOTIONPAY_BILLER_EXTERNAL_ID_MAX_LENGTH,
    }),
  },
  { additionalProperties: false },
);
export type MotionPayBillerStatusRequestDto = Static<
  typeof MotionPayBillerStatusRequestSchema
>;

export const MotionPayBillerStatusResponseSchema = Type.Object({
  status: Type.Number(),
  message: Type.String(),
  description: Type.String(),
  data: Type.Union([
    Type.Null(),
    Type.Object({}),
    Type.Object({
      external_id: Type.String({
        minLength: 1,
        maxLength: MOTIONPAY_BILLER_EXTERNAL_ID_MAX_LENGTH,
      }),
      transaction_id: Type.String({ minLength: 1, maxLength: 64 }),
      product_code: Type.String({ minLength: 1, maxLength: 7 }),
      product_name: Type.String({ minLength: 1, maxLength: 150 }),
      customer_id: Type.String({ minLength: 1, maxLength: 16 }),
      amount: NominalType,
      fee: NominalType,
      penalty: NominalType,
      total: NominalType,
      customer_name: Type.Union([Type.Null(), Type.String()]),
      tarif_daya: Type.Union([Type.Null(), Type.String()]),
      jumlah_kwh: Type.Union([Type.Null(), Type.String()]),
      serial_number: Type.Union([Type.Null(), Type.String()]),
    }),
  ]),
});
export type MotionPayBillerStatusResponseDto = Static<
  typeof MotionPayBillerStatusResponseSchema
>;

/// Callback
export const MotionPayBillerCallbackSchema =
  MotionPayBillerStatusResponseSchema;
export type MotionPayBillerCallbackDto = Static<
  typeof MotionPayBillerCallbackSchema
>;
