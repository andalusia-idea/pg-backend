import { Static, Type } from '@sinclair/typebox';
import {
  MOTIONPAY_AMOUNT,
  MOTIONPAY_EXTERNAL_ID_MAX_LENGTH,
  MOTIONPAY_MIN_SESSION_TIME_MINUTES,
} from '../helper';

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

/**
 * Payment Notification / Callback payload — QRIS Service v2.7 §Callback.
 *
 * Almost every field is optional here, and that is deliberate. This body
 * arrives **unauthenticated** (MotionPay publishes no callback signature), so
 * it is treated as an untrusted trigger rather than as data: we log it, use
 * `transaction_id` to find our own record, and then confirm the real state with
 * an authenticated Get Payment Status call. Rejecting a callback because a
 * field we never read was missing would only cost us a retry we did not need.
 *
 * `transaction_id` and `status` are the two required fields, because without
 * them there is nothing to look up and nothing to act on.
 */
export const MotionPayQrisCallbackSchema = Type.Object(
  {
    transaction_id: Type.String({ minLength: 1 }),
    external_id: Type.Optional(Type.String()),
    amount: Type.Optional(Type.Number()),
    qr_string: Type.Optional(Type.String()),
    /** `QRIS_DYNAMIC` or `QRIS_STATIC`. We only issue dynamic. */
    qris_type: Type.Optional(Type.String()),
    status: Type.String({ minLength: 1 }),
    /** `Payment Received` on success, `Order expired` on an expiry. */
    description: Type.Optional(Type.String()),
    // WIB despite the offset these carry - never parse with `new Date()`,
    // use parseMotionPayTimestamp. See motionpay.helper.ts.
    created_at: Type.Optional(Type.String()),
    updated_at: Type.Optional(Type.String()),
    expired_date: Type.Optional(Type.String()),
    paid_date: Type.Optional(Type.String()),
    mp_mid: Type.Optional(Type.String()),
    fm_mid: Type.Optional(Type.String()),
    merchant_pan: Type.Optional(Type.String()),
    customer_pan: Type.Optional(Type.String()),
    rrn: Type.Optional(Type.String()),
    from_info: Type.Optional(Type.String()),
    acquirer_name: Type.Optional(Type.String()),
    terminal_id: Type.Optional(Type.String()),
    merchant_name: Type.Optional(Type.String()),
    issuer_customer_name: Type.Optional(Type.String()),
    issuer_customer_id: Type.Optional(Type.String()),
  },
  // Unknown fields are kept, not stripped: the whole payload is persisted as
  // evidence, and a field MotionPay adds tomorrow is exactly what we would want
  // to have on file when reconciling a disputed payment.
  { additionalProperties: true },
);
export type MotionPayQrisCallbackDto = Static<
  typeof MotionPayQrisCallbackSchema
>;
