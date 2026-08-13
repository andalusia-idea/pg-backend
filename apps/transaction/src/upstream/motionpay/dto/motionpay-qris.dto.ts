import { Static, Type } from '@sinclair/typebox';
import {
  MOTIONPAY_AMOUNT,
  MOTIONPAY_EXTERNAL_ID_MAX_LENGTH,
  MOTIONPAY_MIN_SESSION_TIME_MINUTES,
} from '../motionpay.constant';

/// REQUEST
export const MotionPayCreateQrisRequestSchema = Type.Object(
  {
    terminal_id: Type.String({
      minLength: 1,
      maxLength: MOTIONPAY_EXTERNAL_ID_MAX_LENGTH,
    }),
    external_id: Type.String({
      minLength: 1,
      maxLength: MOTIONPAY_EXTERNAL_ID_MAX_LENGTH,
    }),
    // Whole rupiah. Bounds are the provider's documented limits, enforced here
    // so an out-of-range amount fails before it costs a round trip.
    amount: Type.Integer({
      minimum: MOTIONPAY_AMOUNT.MIN,
      maximum: MOTIONPAY_AMOUNT.MAX,
    }),
    description: Type.Optional(Type.String()),
    session_time: Type.Integer({
      minimum: MOTIONPAY_MIN_SESSION_TIME_MINUTES,
    }),
    // Required by the provider, but explicitly allowed to be empty strings:
    // the key must be present, the value need not be meaningful.
    fullname: Type.String(),
    email: Type.String(),
    phone_number: Type.String(),
  },
  { additionalProperties: false },
);
export type MotionPayCreateQrisRequestDto = Static<
  typeof MotionPayCreateQrisRequestSchema
>;

/// RESPONSE
const MotionPayEnvelopeStatusSchema = Type.Object({
  code: Type.Number(),
  message: Type.String(),
});

/**
 * Only fields the provider always returns on a successful create are required.
 *
 * `qr_string` is required deliberately: it is documented as generated only for
 * PTEN-registered merchants, and a "successful" purchase with nothing to render
 * for the customer is a failure we want surfaced immediately, not a blank QR.
 */
const MotionPayCreateQrisDataSchema = Type.Object({
  transaction_id: Type.String({ minLength: 1 }),
  external_id: Type.String(),
  amount: Type.Number(),
  qr_string: Type.String({ minLength: 1 }),
  type: Type.String(),
  status: Type.String(),
  description: Type.Optional(Type.String()),
  // Format varies between samples ("2025-03-25T05:09:05+00:00" vs
  // "2023-12-06 18:12:19"), so it stays a string here — parsing it at the
  // client boundary would bake in a timezone assumption.
  created_date: Type.Optional(Type.String()),
  session_time: Type.Optional(Type.Number()),
});

export const MotionPayCreateQrisResponseSchema = Type.Object({
  status: MotionPayEnvelopeStatusSchema,
  data: Type.Union([MotionPayCreateQrisDataSchema, Type.Null()]),
  meta: Type.Optional(Type.Unknown()),
});
export type MotionPayCreateQrisResponseDto = Static<
  typeof MotionPayCreateQrisResponseSchema
>;

/**
 * Status-lookup response.
 *
 * The provider's docs mark every field Required, but its own PENDING example
 * omits `paid_date` and returns empty strings for the settlement fields.
 * Requiring them would reject every pending transaction, so they are optional.
 */
const MotionPayQrisStatusDataSchema = Type.Object({
  transaction_id: Type.String({ minLength: 1 }),
  external_id: Type.String(),
  amount: Type.Number(),
  qr_string: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  status: Type.String(),
  description: Type.Optional(Type.String()),
  created_date: Type.Optional(Type.String()),
  updated_date: Type.Optional(Type.String()),
  expired_date: Type.Optional(Type.String()),
  paid_date: Type.Optional(Type.String()),
  channel: Type.Optional(Type.String()),
  customer_pan: Type.Optional(Type.String()),
  merchant_pan: Type.Optional(Type.String()),
  rrn: Type.Optional(Type.String()),
  from_info: Type.Optional(Type.String()),
  acquirer_name: Type.Optional(Type.String()),
  order_id: Type.Optional(Type.String()),
});

export const MotionPayQrisStatusResponseSchema = Type.Object({
  status: MotionPayEnvelopeStatusSchema,
  data: Type.Union([MotionPayQrisStatusDataSchema, Type.Null()]),
  meta: Type.Optional(Type.Unknown()),
});
export type MotionPayQrisStatusResponseDto = Static<
  typeof MotionPayQrisStatusResponseSchema
>;
