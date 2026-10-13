// Imported from the sibling file rather than the barrel: `microservice.enum.ts`
// pulls in nothing from here, so this direction cannot cycle.
import type { ProviderNameEnum, ROLE } from './microservice.enum';

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

/**
 * Per-job identities over the `SCHEDULER_*` slots.
 *
 * One alias per cron, rather than every job sharing `SYSTEM_USER_ID`: the point
 * of pinning ten slots was that an audit row can say *which* job wrote it. The
 * ids themselves exist already, so adding a job here is naming, not migrating.
 *
 * Keep the assignment in code. While these lived only in prose, two different
 * passages could - and briefly did - hand the same slot to different jobs.
 *
 * `SCHEDULER_01` is reserved for `apps/settlement`'s enqueuer and runner, which
 * Step 11 of docs/batch/settlement-batching-implementation.md will claim. Do not
 * take it for something else.
 */
export const MERCHANT_SECRET_CLEANUP_USER_ID = MACHINE_USER_ID.SCHEDULER_02;

/**
 * The principal an inbound provider callback writes under.
 *
 * A callback is unauthenticated - there is no merchant and no person behind it -
 * so something has to stand in, and a per-provider id says *which* upstream's
 * notification caused a row to change. `SYSTEM_USER_ID` for all of them would
 * have been simpler and would have thrown that away: with one id, a disputed
 * settlement row cannot tell you whether MotionPay or Jatelindo moved it.
 *
 * `SYSTEM_*` slots rather than `SCHEDULER_*`: these run on an inbound HTTP
 * request, not on a timer, and ids 1-10 carry the SYSTEM role while 11-20 carry
 * SCHEDULER. The `RESERVED_*` block is left alone so it stays a reserve.
 *
 * Total over `ProviderNameEnum` on purpose. Uncommenting a provider there is
 * then a compile error here until it has an id - which is the point, because the
 * alternative is a new upstream quietly writing rows attributed to nobody.
 * `INTERNAL` is in the map to keep it total; it is our own ledger-side
 * "provider" and has no callback to receive, so it gets the generic principal.
 */
export const PROVIDER_CALLBACK_USER_ID = {
  INTERNAL: MACHINE_USER_ID.SYSTEM_01,
  MOTIONPAY: MACHINE_USER_ID.SYSTEM_02,
  TELEANJAR: MACHINE_USER_ID.SYSTEM_03,
  JATELINDO: MACHINE_USER_ID.SYSTEM_04,
} as const satisfies Record<ProviderNameEnum, number>;

/** The id the first non-machine account receives. Everything below is pinned. */
export const FIRST_HUMAN_USER_ID = 21;
