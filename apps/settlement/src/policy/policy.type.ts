import type { SettlementModeEnum } from '@app/microservice';

/**
 * Structural inputs, not the generated Prisma models.
 *
 * Deliberate, and the reason is testability: anything importing
 * `@transaction/prisma` cannot be loaded from a spec, because jest's
 * `moduleNameMapper` covers only the `@app/*` libs. Step 9 calls eligibility
 * "the piece worth unit-testing hardest", and a type that makes it untestable
 * would be a poor trade.
 *
 * The call site in Step 10 passes real rows, which satisfy these structurally -
 * so a column rename still breaks the caller, just not this file.
 */

/** The parts of a settled payment that eligibility depends on. */
export type EligibilityPayment = {
  /**
   * Non-null on purpose. The claim selects `status = 'SUCCESS'` only, and a
   * successful payment always has a paid timestamp - so the caller narrows
   * once rather than every mode here guessing what a null should mean.
   */
  readonly paidAt: Date;
};

/** The parts of `MerchantSettlementPolicy` that eligibility depends on. */
export type EligibilityPolicy = {
  readonly mode: SettlementModeEnum;
  /** `FIXED_DELAY` only: 1 = T+1. */
  readonly delayDays: number | null;
  /** `SCHEDULED`: every release time. `FIXED_DELAY`: a single entry. */
  readonly releaseTimes: readonly string[];
  /** Not implemented yet - see the note in `policy.eligibility.ts`. */
  readonly businessDaysOnly: boolean;
};

/**
 * The parts of `UpstreamSettlementWindow` that eligibility depends on.
 *
 * `windowStart` / `windowEnd` / `windowStartDayOffset` are absent because
 * choosing *which* window a payment falls into is the caller's job - see
 * `settlementReleaseAt`.
 */
export type EligibilityWindow = {
  /** 0 = same day, 1 = H+1, 3 = H+3. */
  readonly settlementOffset: number;
  /** Null when the partner publishes no time of day. */
  readonly settlementTime: string | null;
  /** IANA name, e.g. `Asia/Jakarta`. */
  readonly timezone: string;
};
