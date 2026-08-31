/**
 * Key namespace for spent merchant-signature nonces.
 *
 * Redis has no tables, so namespacing is conventional: a colon-delimited
 * prefix. The colon specifically, because tooling (RedisInsight and friends)
 * renders colon-delimited keys as a browsable tree, and `SCAN
 * merchant-signature:nonce:*` stays usable for debugging.
 *
 * Keyed by `clientId` rather than `userId` because clientId arrives in the
 * request itself - a userId key could not be built until after the database
 * lookup resolved it. (The two are 1:1 today; `MerchantSignature.userId` is
 * unique.)
 *
 * The TTL is not here - it is `MerchantSignatureConfig.NONCE_TTL_SECONDS`,
 * which validates it against the timestamp tolerance it has to outlast.
 */
export const NONCE_KEY_PREFIX = 'merchant-signature:nonce';

export const MERCHANT_SIGNATURE_KEY_PREFIX = 'merchant-signature:db';

export const BASE_FEE_KEY_PREFIX = 'base-fee';

export const MERCHANT_FEE_KEY_PREFIX = 'merchant-fee';

export const AGENT_SHAREHOLDER_KEY_PREFIX = 'agent-shareholder';

/** Key namespace for per-merchant request budgets. */
export const RATE_LIMIT_KEY_PREFIX = 'merchant-signature:rate';

export const PROFILE_PROVIDER_KEY_PREFIX = 'profile:provider';

export const PROFILE_BANK_KEY_PREFIX = 'profile:bank';
