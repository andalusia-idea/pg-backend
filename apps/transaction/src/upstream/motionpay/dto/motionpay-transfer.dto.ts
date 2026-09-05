import { Static, Type } from '@sinclair/typebox';
import {
  MOTIONPAY_TRANSFER_AMOUNT,
  MOTIONPAY_TRANSFER_EXTERNAL_ID_MAX_LENGTH,
} from '../helper';
import { MOTIONPAY_BANK_CODE_MAX_LENGTH } from '../helper';

/**
 * Transfer envelopes differ from QRIS in shape, so none of the QRIS schemas
 * are reusable here. Three distinct forms exist across MotionPay:
 *
 *   QRIS            → status: { code: number, message: string }
 *   Transfer token  → status: number, message, description
 *   Transfer service→ status: { success: boolean, code: string, message }
 *
 * The transfer service code is a zero-padded **string** ("0001"), not a number.
 */

/// AUTH
export const MotionPayTransferTokenRequestSchema = Type.Object(
  {
    client_key: Type.String({ minLength: 1 }),
    server_key: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type MotionPayTransferTokenRequestDto = Static<
  typeof MotionPayTransferTokenRequestSchema
>;

export const MotionPayTransferTokenResponseSchema = Type.Object({
  // A bare number here, unlike every other MotionPay response.
  status: Type.Number(),
  message: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  data: Type.Union([
    Type.Object({ token: Type.String({ minLength: 1 }) }),
    Type.Null(),
  ]),
  meta: Type.Optional(Type.Unknown()),
});
export type MotionPayTransferTokenResponseDto = Static<
  typeof MotionPayTransferTokenResponseSchema
>;

/// SHARED SERVICE ENVELOPE
const MotionPayTransferStatusSchema = Type.Object({
  success: Type.Boolean(),
  code: Type.String(),
  message: Type.String(),
});

/// ACCOUNT INQUIRY
export const MotionPayAccountInquiryRequestSchema = Type.Object(
  {
    // Deliberately not `maxLength: 3` despite the docs saying "String, 3":
    // valid codes include '013S' and 'SHOPEEPAY'. See the bank-code constant.
    bank_code: Type.String({
      minLength: 1,
      maxLength: MOTIONPAY_BANK_CODE_MAX_LENGTH,
    }),
    bank_account: Type.String({ minLength: 1, maxLength: 16 }),
    external_id: Type.String({
      minLength: 1,
      maxLength: MOTIONPAY_TRANSFER_EXTERNAL_ID_MAX_LENGTH,
    }),
  },
  { additionalProperties: false },
);
export type MotionPayAccountInquiryRequestDto = Static<
  typeof MotionPayAccountInquiryRequestSchema
>;

export const MotionPayAccountInquiryResponseSchema = Type.Object({
  data: Type.Union([
    Type.Object({
      bank_code: Type.Optional(Type.String()),
      bank_account: Type.Optional(Type.String()),
      // Empty string when the lookup fails — the failure sample returns
      // `name: ""` rather than omitting it or erroring.
      name: Type.Optional(Type.String()),
    }),
    Type.Null(),
  ]),
  meta: Type.Optional(Type.Unknown()),
  status: MotionPayTransferStatusSchema,
});
export type MotionPayAccountInquiryResponseDto = Static<
  typeof MotionPayAccountInquiryResponseSchema
>;

/// FUND TRANSFER
export const MotionPayFundTransferRequestSchema = Type.Object(
  {
    recipient_bank: Type.String({
      minLength: 1,
      maxLength: MOTIONPAY_BANK_CODE_MAX_LENGTH,
    }),
    recipient_account: Type.String({ minLength: 1, maxLength: 16 }),
    recipient_name: Type.Optional(Type.String({ maxLength: 45 })),
    // Whole rupiah. Bounds differ from QRIS — 10.000 to 50.000.000 here.
    amount: Type.Integer({
      minimum: MOTIONPAY_TRANSFER_AMOUNT.MIN,
      maximum: MOTIONPAY_TRANSFER_AMOUNT.MAX,
    }),
    note: Type.String({ minLength: 1, maxLength: 64 }),
    external_id: Type.String({
      minLength: 1,
      maxLength: MOTIONPAY_TRANSFER_EXTERNAL_ID_MAX_LENGTH,
    }),
  },
  { additionalProperties: false },
);
export type MotionPayFundTransferRequestDto = Static<
  typeof MotionPayFundTransferRequestSchema
>;

export const MotionPayFundTransferResponseSchema = Type.Object({
  data: Type.Union([
    Type.Object({
      transaction_id: Type.Optional(Type.String()),
      external_id: Type.Optional(Type.String()),
    }),
    Type.Null(),
  ]),
  meta: Type.Optional(Type.Unknown()),
  status: MotionPayTransferStatusSchema,
});
export type MotionPayFundTransferResponseDto = Static<
  typeof MotionPayFundTransferResponseSchema
>;

/// CHECK TRANSFER STATUS
export const MotionPayTransferStatusResponseSchema = Type.Object({
  data: Type.Union([
    Type.Object({
      transaction_id: Type.Optional(Type.String()),
      external_id: Type.Optional(Type.String()),
      /** SUCCESS | PENDING | FAILED */
      status: Type.Optional(Type.String()),
    }),
    Type.Null(),
  ]),
  meta: Type.Optional(Type.Unknown()),
  status: MotionPayTransferStatusSchema,
});
export type MotionPayTransferStatusResponseDto = Static<
  typeof MotionPayTransferStatusResponseSchema
>;

/// CHECK BALANCE
export const MotionPayBalanceResponseSchema = Type.Object({
  data: Type.Union([
    Type.Object({
      disbursement_id: Type.Optional(Type.Number()),
      deposit: Type.Optional(Type.Number()),
    }),
    Type.Null(),
  ]),
  // The balance sample omits `meta` entirely, unlike the others.
  meta: Type.Optional(Type.Unknown()),
  status: MotionPayTransferStatusSchema,
});
export type MotionPayBalanceResponseDto = Static<
  typeof MotionPayBalanceResponseSchema
>;

/// CALLBACK (inbound — MotionPay POSTs this to a URL registered in their dashboard)
export const MotionPayTransferCallbackSchema = Type.Object({
  data: Type.Object({
    transaction_id: Type.Optional(Type.String()),
    external_id: Type.Optional(Type.String()),
    /** Merchant disbursement id — a string in the samples despite "Integer, 11". */
    id: Type.Optional(Type.String()),
    fm_user_reference_number: Type.Optional(
      Type.Union([Type.String(), Type.Null()]),
    ),
    user_reference_number: Type.Optional(
      Type.Union([Type.String(), Type.Null()]),
    ),
  }),
  status: MotionPayTransferStatusSchema,
  meta: Type.Optional(Type.Unknown()),
});
export type MotionPayTransferCallbackDto = Static<
  typeof MotionPayTransferCallbackSchema
>;
