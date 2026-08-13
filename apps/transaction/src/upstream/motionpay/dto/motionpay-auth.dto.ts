import { Static, Type } from '@sinclair/typebox';

/// REQUEST
export const MotionPayTokenRequestSchema = Type.Object(
  {
    client_key: Type.String({ minLength: 1 }),
    server_key: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type MotionPayTokenRequestDto = Static<
  typeof MotionPayTokenRequestSchema
>;

/// RESPONSE
/**
 * `additionalProperties` is left open on every response schema: the provider's
 * raw payload is persisted as transaction metadata, so unknown fields must
 * survive validation rather than being stripped.
 */
export const MotionPayTokenResponseSchema = Type.Object({
  status: Type.Object({
    code: Type.Number(),
    message: Type.String(),
  }),
  data: Type.Union([
    Type.Object({ token: Type.String({ minLength: 1 }) }),
    Type.Null(),
  ]),
  meta: Type.Optional(Type.Unknown()),
});
export type MotionPayTokenResponseDto = Static<
  typeof MotionPayTokenResponseSchema
>;
