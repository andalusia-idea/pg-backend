import { SettlementModeEnum } from '@app/microservice';
import {
  atTimeOnDay,
  inZone,
  SETTLEMENT_TIMEZONE,
  sortedTimes,
} from './policy.time';
import type {
  EligibilityPayment,
  EligibilityPolicy,
  EligibilityWindow,
} from './policy.type';

/**
 * The moment a payment's funds become available to the merchant.
 *
 * Pure: no clock, no database. `isEligible` is this compared against `now`, and
 * the dashboard can show the same value as "available at" without duplicating a
 * single rule.
 *
 * **`businessDaysOnly` throws rather than being ignored.** The holiday calendar
 * is deliberately unbuilt until Pakailink is live (Step 9), and silently
 * treating the flag as `false` would release a merchant's money on a public
 * holiday while the admin who ticked the box believes otherwise. Failing the run
 * for that merchant is recoverable; paying early is not.
 *
 * @param window Required for `FOLLOW_UPSTREAM`, ignored otherwise. Choosing
 *   which window a payment falls into is the caller's job: a partner can run
 *   several per method, and the boundary rules for Teleanjar's two batches are
 *   still open questions with the partner - see
 *   docs/accounting/upstream-settlement-schedules.md. Resolving it here would
 *   mean inventing an answer they have not given.
 */
export function settlementReleaseAt(
  payment: EligibilityPayment,
  policy: EligibilityPolicy,
  window?: EligibilityWindow,
): Date {
  if (policy.businessDaysOnly) {
    throw new Error(
      'settlement: businessDaysOnly is set on this policy, but the business-day ' +
        'calendar is not implemented. Refusing to settle rather than release ' +
        'funds on a day the policy says to skip.',
    );
  }

  switch (policy.mode) {
    case SettlementModeEnum.INSTANT:
      // Available the moment it succeeded - there is nothing to wait for.
      return payment.paidAt;

    case SettlementModeEnum.FIXED_DELAY:
      return fixedDelayRelease(payment, policy);

    case SettlementModeEnum.SCHEDULED:
      return scheduledRelease(payment, policy);

    case SettlementModeEnum.FOLLOW_UPSTREAM:
      return followUpstreamRelease(payment, window);
  }
}

/** Whether `now` has reached the moment this payment's funds are released. */
export function isEligible(
  payment: EligibilityPayment,
  policy: EligibilityPolicy,
  now: Date,
  window?: EligibilityWindow,
): boolean {
  return (
    now.getTime() >= settlementReleaseAt(payment, policy, window).getTime()
  );
}

/** `delayDays` whole days after the payment, at the single release time. */
function fixedDelayRelease(
  payment: EligibilityPayment,
  policy: EligibilityPolicy,
): Date {
  if (policy.delayDays === null || !Number.isInteger(policy.delayDays)) {
    throw new Error(
      `settlement: FIXED_DELAY needs a whole-number delayDays, got ${String(policy.delayDays)}.`,
    );
  }

  if (policy.delayDays < 0) {
    throw new Error(
      `settlement: FIXED_DELAY delayDays cannot be negative, got ${policy.delayDays}.`,
    );
  }

  const [releaseTime] = policy.releaseTimes;

  if (releaseTime === undefined) {
    throw new Error(
      'settlement: FIXED_DELAY needs one entry in releaseTimes, got none.',
    );
  }

  const paid = inZone(payment.paidAt, SETTLEMENT_TIMEZONE, 'paidAt');

  // Whole days from the payment's *calendar day*, not 24-hour multiples of the
  // payment instant: T+1 at 10:00 means tomorrow at 10:00 for a payment at
  // 23:59 just as it does for one at 00:01.
  return atTimeOnDay(
    paid.startOf('day').plus({ days: policy.delayDays }),
    releaseTime,
    'FIXED_DELAY releaseTimes[0]',
  ).toJSDate();
}

/** The first release time at or after the payment, rolling to the next day. */
function scheduledRelease(
  payment: EligibilityPayment,
  policy: EligibilityPolicy,
): Date {
  if (policy.releaseTimes.length === 0) {
    throw new Error(
      'settlement: SCHEDULED needs at least one entry in releaseTimes, got none.',
    );
  }

  // Zero-padded HH:mm sorts chronologically as text, which the regex enforces.
  const times = sortedTimes(policy.releaseTimes);
  const paid = inZone(payment.paidAt, SETTLEMENT_TIMEZONE, 'paidAt');
  const startOfDay = paid.startOf('day');

  const today = times.map((time) =>
    atTimeOnDay(startOfDay, time, 'SCHEDULED releaseTimes'),
  );

  // At, not after: a payment landing exactly on a release time goes out in that
  // batch rather than waiting for the next one.
  const next = today.find((release) => release.toMillis() >= paid.toMillis());

  if (next) return next.toJSDate();

  // Paid after the last batch of the day - first batch tomorrow. `times[0]` is
  // present because the array is non-empty and sorting does not change that.
  return atTimeOnDay(
    startOfDay.plus({ days: 1 }),
    times[0],
    'SCHEDULED releaseTimes',
  ).toJSDate();
}

/** `settlementOffset` days after the payment, at the partner's stated time. */
function followUpstreamRelease(
  payment: EligibilityPayment,
  window?: EligibilityWindow,
): Date {
  if (!window) {
    throw new Error(
      'settlement: FOLLOW_UPSTREAM needs the UpstreamSettlementWindow for this ' +
        "payment's provider and method. Resolve it before calling.",
    );
  }

  if (
    !Number.isInteger(window.settlementOffset) ||
    window.settlementOffset < 0
  ) {
    throw new Error(
      `settlement: settlementOffset must be a non-negative whole number of days, got ${String(window.settlementOffset)}.`,
    );
  }

  const paid = inZone(payment.paidAt, window.timezone, 'paidAt');
  const day = paid.startOf('day').plus({ days: window.settlementOffset });

  // No published time means assume the latest it could land, not the earliest.
  // MotionPay's E-Wallet payouts are "H+3" with no hour attached; releasing at
  // 00:00 on H+3 would be us paying out before they have.
  return window.settlementTime === null
    ? day.endOf('day').toJSDate()
    : atTimeOnDay(day, window.settlementTime, 'settlementTime').toJSDate();
}
