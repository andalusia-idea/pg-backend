import { Type } from '@sinclair/typebox';

export const MoneyType = Type.String({
  pattern: '^\\d+(\\.\\d{1,2})?$',
  minLength: 1,
  maxLength: 32,
});

export const PercentageType = Type.String({
  pattern: `^(100(\\.0{1,2})?|[0-9]{1,2}(\\.\\d{1,2})?)$`,
  minLength: 1,
  maxLength: 8,
});

// export function PercentageType(decimalPlaces: 2 | 4 = 2) {
//   return Type.String({
//     pattern: `^(100(\\.0{1,${decimalPlaces}})?|[0-9]{1,2}(\\.\\d{1,${decimalPlaces}})?)$`,
//     minLength: 1,
//     maxLength: 8,
//   });
// }

/**
 * The coarse profile category a user belongs to - which detail table holds
 * their profile row, and what crosses service boundaries in DTOs.
 *
 * Distinct from `ROLE` below: several roles can map to one category (both
 * ADMIN_SUPER and ADMIN are `ADMIN` here). Use `PROFILE_KIND_BY_ROLE` to go
 * from one to the other.
 */
export const UserRoleEnum = {
  ADMIN: 'ADMIN',
  AGENT: 'AGENT',
  MERCHANT: 'MERCHANT',
} as const;
export type UserRoleEnum = (typeof UserRoleEnum)[keyof typeof UserRoleEnum];

/**
 * Role names exactly as stored in `auth.Role.name`.
 *
 * Shared because every app reasons about roles: auth issues them, the dashboard
 * gates on them, and they travel inside the JWT. Modelled as a const object
 * rather than a TS enum so the derived type is a plain string-literal union -
 * values arriving as JSON (JWT claims, request bodies) are structurally
 * compatible with no cast, and Swagger / class-validator both accept the object
 * form.
 *
 * SYSTEM and SCHEDULER are machine principals: they have no profile row and
 * cannot sign in.
 */
export const ROLE = {
  SYSTEM: 'SYSTEM',
  SCHEDULER: 'SCHEDULER',
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  AGENT: 'AGENT',
  MERCHANT: 'MERCHANT',
} as const;
export type ROLE = (typeof ROLE)[keyof typeof ROLE];

/**
 * Which detail table holds a role's profile row.
 *
 * Legacy resolved this by substring-matching the role name
 * (`role.includes('MERCHANT')`, `includes('AGENT')`, else admin). That happens
 * to be right for today's names, but only by luck of the check order - a future
 * `MERCHANT_ADMIN` would resolve to the merchant table. Stated explicitly here
 * so the answer does not depend on how the names are spelled.
 *
 * SYSTEM and SCHEDULER are absent on purpose - they have no profile row.
 */
export const PROFILE_KIND_BY_ROLE = {
  [ROLE.SUPER_ADMIN]: UserRoleEnum.ADMIN,
  [ROLE.ADMIN]: UserRoleEnum.ADMIN,
  [ROLE.AGENT]: UserRoleEnum.AGENT,
  [ROLE.MERCHANT]: UserRoleEnum.MERCHANT,
} as const satisfies Partial<Record<ROLE, UserRoleEnum>>;

export const ProviderNameEnum = {
  INTERNAL: 'INTERNAL',
  MOTIONPAY: 'MOTIONPAY',
  // INACASH: 'INACASH',
  // PDNT1: 'PDNT1',
  // ZIPAY: 'ZIPAY',
  // PAKAIDONK: 'PAKAIDONK',
} as const;
export type ProviderNameEnum =
  (typeof ProviderNameEnum)[keyof typeof ProviderNameEnum];

export const PaymentMethodNameEnum = {
  QRIS: 'QRIS',
  VIRTUALACCOUNT: 'VIRTUALACCOUNT',
  DIRECTEWALLET: 'DIRECTEWALLET',
  TRANSFERBANK: 'TRANSFERBANK',
  TRANSFEREWALLET: 'TRANSFEREWALLET',
} as const;
export type PaymentMethodNameEnum =
  (typeof PaymentMethodNameEnum)[keyof typeof PaymentMethodNameEnum];

export const TransactionTypeEnum = {
  WITHDRAW: 'WITHDRAW',
  TOPUP: 'TOPUP',
  DISBURSEMENT: 'DISBURSEMENT',
  PURCHASE: 'PURCHASE',
  SETTLEMENT_PURCHASE: 'SETTLEMENT_PURCHASE',
} as const;
export type TransactionTypeEnum =
  (typeof TransactionTypeEnum)[keyof typeof TransactionTypeEnum];

export const MerchantSignatureStatusEnum = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type MerchantSignatureStatusEnum =
  (typeof MerchantSignatureStatusEnum)[keyof typeof MerchantSignatureStatusEnum];

/** Verbs the merchant Public API exposes. Part of the signed canonical string. */
export const HttpMethodEnum = {
  GET: 'GET',
  POST: 'POST',
} as const;
export type HttpMethodEnum =
  (typeof HttpMethodEnum)[keyof typeof HttpMethodEnum];

/**
 * Why a merchant signature was rejected.
 *
 * Every rejection is an HTTP 401 to the merchant; this code is what makes the
 * failure diagnosable. Collapsing them into one opaque "invalid signature" is
 * the top integration-support cost in every payment API - a merchant whose
 * clock drifted three minutes needs to see that, not a crypto error.
 *
 * None of these leak anything useful to an attacker: they already know
 * whether they hold a valid secret.
 */
export const MerchantSignatureFailureEnum = {
  /** One of the four required headers was absent. */
  MISSING_HEADER: 'MISSING_HEADER',
  /**
   * `X-Signature` was not the expected length or not hex.
   *
   * Also the code a merchant sees if they implemented the wrong algorithm:
   * digest length identifies it (SHA-256 gives 64 hex, SHA-512 gives 128), so
   * the error message should name both the expected length and the algorithm.
   */
  MALFORMED_SIGNATURE: 'MALFORMED_SIGNATURE',
  /** `X-Nonce` was not a UUID or hex string - see the delimiter note in the design doc. */
  MALFORMED_NONCE: 'MALFORMED_NONCE',
  /** `X-Timestamp` had no UTC offset, was unparseable, or fell outside the window. */
  TIMESTAMP_SKEW: 'TIMESTAMP_SKEW',
  /** No merchant signature row matches the supplied `X-Client-Id`. */
  UNKNOWN_CLIENT: 'UNKNOWN_CLIENT',
  /** The client exists but its status is not ACTIVE. */
  CLIENT_SUSPENDED: 'CLIENT_SUSPENDED',
  /** The MAC did not match, under either the current or the previous secret. */
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  /** This nonce was already used inside the replay window. */
  REPLAYED_NONCE: 'REPLAYED_NONCE',
  /** Merchant has not yet generated Secret Key at Dashboard */
  SECRET_KEY_NOT_GENERATED: 'SECRET_KEY_NOT_GENERATED',
} as const;
export type MerchantSignatureFailureEnum =
  (typeof MerchantSignatureFailureEnum)[keyof typeof MerchantSignatureFailureEnum];
