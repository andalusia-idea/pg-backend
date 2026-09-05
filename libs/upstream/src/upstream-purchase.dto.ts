import {
  AmountType,
  MoneyType,
  ProviderNameEnum,
  TransactionStatusEnum,
} from '@app/microservice';
import { Static, Type } from '@sinclair/typebox';

export const UpstreamQrisRequestSchema = Type.Object({
  systemReference: Type.String(),
  providerName: Type.Enum(ProviderNameEnum),
  merchantReference: Type.String(),
  amount: AmountType,
  expireSeconds: Type.Number(),
});
export type UpstreamQrisRequestDto = Static<typeof UpstreamQrisRequestSchema>;

export const UpstreamQrisResponseSchema = Type.Object({
  providerReference: Type.String(),
  qrString: Type.String(),
  nominal: Type.String(),
  expiresAt: Type.String(),
  status: Type.Enum(TransactionStatusEnum),
  message: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamQrisResponseDto = Static<typeof UpstreamQrisResponseSchema>;

export const UpstreamQrisStatusRequestSchema = Type.Object({
  systemReference: Type.Union([Type.String(), Type.Null()]),
  providerReference: Type.String(),
});
export type UpstreamQrisStatusRequestDto = Static<
  typeof UpstreamQrisStatusRequestSchema
>;

export const UpstreamQrisStatusResponseSchema = Type.Object({
  /**
   * The merchant's own reference, echoed back by the provider.
   *
   * Named for what it is: MotionPay returns it as `external_id`, and that is
   * the value we send as `merchantReference` on create - not our
   * `systemReference`. Calling it the latter invited a lookup against the wrong
   * column.
   */
  merchantReference: Type.String(),
  providerReference: Type.String(),
  status: Type.Enum(TransactionStatusEnum),
  nominal: MoneyType,
  paidAt: Type.Union([Type.String(), Type.Null()]),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  metadata: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamQrisStatusResponseDto = Static<
  typeof UpstreamQrisStatusResponseSchema
>;

/**
 * A provider payment notification, normalised.
 *
 * This is the boundary between a provider adapter and the business layer: the
 * adapter turns whatever the provider POSTed into this shape, and everything
 * downstream is written against it. Adding a second provider means writing one
 * more translation into this type, not touching the settlement flow.
 *
 * Deliberately carries **no transport detail** - no source IP, no headers. The
 * origin check belongs to the adapter that understands that provider's
 * authentication (or lack of it), and has already happened by the time this
 * exists.
 */
export const UpstreamWebhookQrisSchema = Type.Object({
  /** The provider's identifier. What we look our transaction up by. */
  providerReference: Type.String(),
  /**
   * The merchant's reference, echoed back. Nullable because a provider may
   * omit it - it is corroboration, never the lookup key.
   */
  merchantReference: Type.Union([Type.String(), Type.Null()]),
  providerName: Type.Enum(ProviderNameEnum),
  status: Type.Enum(TransactionStatusEnum),
  nominal: MoneyType,
  /**
   * Already parsed by the adapter, which is the only layer that knows what a
   * given provider's timestamps mean - see `parseMotionPayTimestamp` for why
   * that is not a formality. **Null when nothing was paid**, which is the
   * normal case for an expired or failed notification.
   */
  paidAt: Type.Union([Type.Date(), Type.Null()]),
  /** The raw provider payload, keyed by event, for the transaction's metadata. */
  metadata: Type.Record(Type.String(), Type.Unknown()),
  /** The raw body exactly as received, for the webhook log. */
  rawPayload: Type.Record(Type.String(), Type.Unknown()),
});
export type UpstreamWebhookQrisDto = Static<typeof UpstreamWebhookQrisSchema>;
