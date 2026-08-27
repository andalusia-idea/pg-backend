import { Type, Static } from '@sinclair/typebox';
import { HttpMethodEnum } from '../microservice.enum';
import { MerchantSignatureFailureEnum } from '../merchant.enum';

/// REQUEST
/**
 * What the transaction app's guard sends to auth to have a merchant request
 * verified.
 *
 * **The body never crosses this boundary - only its hash.** Legacy shipped the
 * whole parsed body, and its HTTP fallback passed it as `axios` query params,
 * putting merchant request bodies into every access log on the path. A
 * fixed-size hash makes that impossible by construction.
 *
 * Every field here is strictly validated because by this point the guard has
 * already rejected malformed input with a typed reason. Anything that fails
 * this schema is a guard bug, not a merchant error, and should fail loudly.
 */
export const FilterMerchantSignatureValidationSchema = Type.Object(
  {
    /** From `X-Client-Id`. */
    clientId: Type.String({ minLength: 1, maxLength: 64 }),
    /** From `X-Timestamp`. ISO-8601 with a mandatory UTC offset. */
    timestampIso: Type.String({ minLength: 1, maxLength: 64 }),
    /** From `X-Nonce`. Guard-checked to contain no colon - it is a canonical-string field. */
    nonce: Type.String({ minLength: 8, maxLength: 128 }),
    /**
     * From `X-Signature`. HMAC-SHA512 is 64 bytes, so 128 hex characters.
     *
     * There is no algorithm field: the algorithm is fixed server-side, and a
     * client-declared one would be both uninformative and an invitation to
     * JWT-style `alg` confusion. Length identifies the algorithm anyway.
     */
    signature: Type.String({ pattern: '^[0-9a-fA-F]{128}$' }),

    /** Read from the request by the guard, not supplied by the merchant. */
    httpMethod: Type.Enum(HttpMethodEnum),
    /** Global prefix already stripped, query string included. */
    endpoint: Type.String({ minLength: 1, maxLength: 2048 }),
    /** Lowercase hex SHA-256 of the raw request bytes. */
    bodyHash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  },
  { additionalProperties: false },
);
export type FilterMerchantSignatureValidationDto = Static<
  typeof FilterMerchantSignatureValidationSchema
>;

/// RESPONSE
export const MerchantSignatureValidationSchema = Type.Object(
  {
    isValid: Type.Boolean(),
    /**
     * Null when no client could be resolved. Legacy returned `0` here, which
     * is a real user id in a different table and silently truthy-adjacent -
     * null forces callers to handle the case.
     */
    userId: Type.Union([Type.Number(), Type.Null()]),
    /** Null when `isValid` is true. */
    reason: Type.Union([Type.Enum(MerchantSignatureFailureEnum), Type.Null()]),
    /**
     * Always populated, success or failure. Echoed to the merchant on a
     * TIMESTAMP_SKEW rejection so they can diagnose clock drift themselves
     * instead of opening a support ticket.
     */
    serverTime: Type.String(),
  },
  { additionalProperties: false },
);
export type MerchantSignatureValidationDto = Static<
  typeof MerchantSignatureValidationSchema
>;

export const FilterMerchantWebhookUrlSchema = Type.Object(
  {
    userId: Type.Number(),
  },
  { additionalProperties: false },
);
export type FilterMerchantWebhookUrlDto = Static<
  typeof FilterMerchantWebhookUrlSchema
>;

export const MerchantWebhookUrlSchema = Type.Object(
  {
    payinUrl: Type.Union([Type.String(), Type.Null()]),
    payoutUrl: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type MerchantWebhookUrlDto = Static<typeof MerchantWebhookUrlSchema>;
