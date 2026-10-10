// Imported from the sibling file rather than the barrel: `microservice.enum.ts`
// pulls in nothing from here, so this direction cannot cycle.
import type { ROLE } from './microservice.enum';

/** Default timeout for a TCP call before it's treated as failed. */
export const MICROSERVICE_CALL_TIMEOUT_MS = 5000;

export const AUTH_CLIENT = Symbol('AUTH_CLIENT');
export const CONFIG_CLIENT = Symbol('CONFIG_CLIENT');
export const TRANSACTION_CLIENT = Symbol('TRANSACTION_CLIENT');

export const AUTH_CMD = {
  FIND_PROFILE_BANK: 'find_profile_bank',
  MERCHANT_SIGNATURE_VALIDATION: 'merchant_signature_validation',
  MERCHANT_SIGNATURE_WEBHOOK_URL: 'merchant_signature_webhook_url',
} as const;

export const CONFIG_CMD = {
  CALCULATE_FEE_PURCHASE: 'calculate_fee_purchase',
  // CALCULATE_FEE_WITHDRAW: 'calculate_fee_withdraw',
  // CALCULATE_FEE_TOPUP: 'calculate_fee_topup',
  CALCULATE_FEE_DISBURSEMENT: 'calculate_fee_disbursement',

  FIND_PROFILE_PROVIDER: 'find_profile_provider',
} as const;

/**
 * Role row ids, pinned by the `machine_principals` migration.
 *
 * Previously resolved by name at seed time, because `Role.name` carried no
 * unique constraint. The migration added one and fixed the ids, so a lookup is
 * no longer needed - and could not work anyway for the machine users the same
 * migration inserts, since migrations run before seeds.
 */
export const ROLE_ID = {
  SYSTEM: 1,
  SCHEDULER: 2,
  SUPER_ADMIN: 3,
  ADMIN: 4,
  AGENT: 5,
  MERCHANT: 6,
} as const satisfies Record<ROLE, number>;

/**
 * The 20 machine principals, pinned by the `machine_principals` migration.
 *
 * Not a convenience - a correctness requirement. `BalanceEntry.createdBy` is
 * NOT NULL, so anything the engine does on its own initiative (a provider
 * webhook crediting a balance, a cron clearing a retired secret) has to name
 * the principal that did it. A wrong id does not fail; it attributes money
 * movements to whoever happens to hold that id.
 *
 * These accounts cannot sign in: the migration gives them a password value that
 * is not a valid argon2 hash, so verification always rejects.
 *
 * Which scheduler runs which job is deliberately *not* encoded here - that
 * allocation lives in docs/batch/settlement-batching-implementation.md §7.1,
 * where it can change without touching a constant every app imports.
 */
export const MACHINE_USER_ID = {
  SYSTEM_01: 1,
  SYSTEM_02: 2,
  SYSTEM_03: 3,
  SYSTEM_04: 4,
  SYSTEM_05: 5,

  /** Spare SYSTEM-role slots, so ids stay stable if a new principal is needed. */
  RESERVED_01: 6,
  RESERVED_02: 7,
  RESERVED_03: 8,
  RESERVED_04: 9,
  RESERVED_05: 10,

  SCHEDULER_01: 11,
  SCHEDULER_02: 12,
  SCHEDULER_03: 13,
  SCHEDULER_04: 14,
  SCHEDULER_05: 15,
  SCHEDULER_06: 16,
  SCHEDULER_07: 17,
  SCHEDULER_08: 18,
  SCHEDULER_09: 19,
  SCHEDULER_10: 20,
} as const;
export type MACHINE_USER_ID =
  (typeof MACHINE_USER_ID)[keyof typeof MACHINE_USER_ID];

/**
 * The audit identity for work the engine initiates with no user behind it.
 *
 * `system01` by convention - it is the principal every other seeded row is
 * attributed to, and the only one with a null `createdBy` of its own.
 */
export const SYSTEM_USER_ID = MACHINE_USER_ID.SYSTEM_01;

/** The id the first non-machine account receives. Everything below is pinned. */
export const FIRST_HUMAN_USER_ID = 21;
