import { SettlementModeEnum } from '@app/microservice';
import { DateTime } from 'luxon';
import {
  atTimeOnDay,
  inZone,
  SETTLEMENT_TIMEZONE,
  sortedTimes,
} from './policy.time';
import type { EligibilityPolicy, EligibilityWindow } from './policy.type';

/**
 * Turning a policy into the two timestamps the batching machinery needs.
 *
 * `policy.eligibility.ts` answers "when does *this payment* release?" - one
 * payment at a time, which is what a unit test or a dashboard asks. This file
 * answers the two questions that are about a *merchant*:
 *
 * - `mostRecentDueAt` - "when was this merchant last due?", for the enqueuer's
 *   `SettlementRun.dueAt`.
 * - `settlementCutoff` - "which of their payments are ripe right now?", for the
 *   claim's `WHERE "paidAt" < $cutoff`.
 *
 * Both derive from the same release boundaries, which is why they live together
 * and share `boundaryAtOrBefore`. They must agree with `settlementReleaseAt`:
 * if the cutoff let through a payment whose release moment has not passed, the
 * merchant would be paid early, and no constraint anywhere would catch it.
 *
 * See *From a policy to a `dueAt`* in
 * docs/batch/settlement-policy-explained.md for the reasoning.
 */

/**
 * How finely `INSTANT` is approximated.
 *
 * `INSTANT` has no schedule, so it has no release boundary, so there is nothing
 * deterministic to use as a `dueAt` - and `dueAt` has to be deterministic or
 * `@@unique([merchantId, paymentMethodName, dueAt])` stops collapsing the
 * enqueuer's repeat ticks. Truncating the clock into fixed slots gives a value
 * both pods compute identically, at the cost of "instant" meaning "within this
 * many minutes".
 *
 * 144 runs per merchant per day at ten minutes. Fine for a handful of merchants
 * on this mode, linear in cost if it spreads - shorten it only for a merchant
 * actually paying for the speed.
 */
export const INSTANT_SLOT_MINUTES = 10;

/**
 * The most recent release boundary at or before `now`, or `null` when the
 * policy has no boundary that has passed yet.
 *
 * This is `SettlementRun.dueAt`. It is **always a scheduled moment**, never
 * `now` itself - that is the whole point. A moving value never collides on the
 * run's unique key, so every enqueuer tick would insert another row.
 *
 * Note what does *not* appear below: `delayDays` and `settlementOffset`. A
 * `FIXED_DELAY` of two days still releases something every day at its release
 * time, so the boundary is daily either way; the delay decides *which* payments
 * are ripe, which is `settlementCutoff`'s job.
 *
 * @param window Required for `FOLLOW_UPSTREAM`. `null` is returned without it,
 *   rather than throwing, because a method nobody has seeded a window for
 *   should be skipped quietly by the enqueuer, not break the whole tick.
 */
export function mostRecentDueAt(
  policy: EligibilityPolicy,
  now: Date,
  window?: EligibilityWindow,
): Date | null {
  assertNoBusinessDays(policy);

  switch (policy.mode) {
    case SettlementModeEnum.SCHEDULED:
    case SettlementModeEnum.FIXED_DELAY: {
      // One code path, deliberately: a FIXED_DELAY policy carries exactly one
      // release time, and a one-entry list is just a list.
      const boundary = boundaryAtOrBefore(
        timeBoundaries(policy.releaseTimes, `${policy.mode} releaseTimes`),
        SETTLEMENT_TIMEZONE,
        now,
      );

      return boundary?.toJSDate() ?? null;
    }

    case SettlementModeEnum.FOLLOW_UPSTREAM: {
      if (!window) return null;

      const boundary = boundaryAtOrBefore(
        upstreamBoundaries(window),
        window.timezone,
        now,
      );

      return boundary?.toJSDate() ?? null;
    }

    case SettlementModeEnum.INSTANT:
      return currentSlot(now).toJSDate();
  }
}

/**
 * The exclusive `paidAt` cutoff for a claim running at `now`: every payment
 * strictly before it has had its release moment pass.
 *
 * Exclusive rather than inclusive because the boundaries are day-aligned - the
 * cutoff lands on a midnight or a release time, and a payment exactly *on* that
 * instant belongs to the batch after it. `settlementReleaseAt` uses "at or
 * after" for the same reason from the other direction.
 *
 * Returns `null` when nothing is ripe yet, which the caller should treat as
 * "claim nothing" rather than "claim everything".
 */
export function settlementCutoff(
  policy: EligibilityPolicy,
  now: Date,
  window?: EligibilityWindow,
): Date | null {
  assertNoBusinessDays(policy);

  switch (policy.mode) {
    case SettlementModeEnum.INSTANT:
      // Nothing to wait for, so everything captured up to and including this
      // instant is ripe. The cutoff is exclusive, hence the millisecond: it
      // makes `paidAt < cutoff` agree with `isEligible` for a payment landing
      // exactly now. The slot in `mostRecentDueAt` only names the run.
      return new Date(now.getTime() + 1);

    case SettlementModeEnum.SCHEDULED: {
      // A payment is ripe when the first boundary at or after it has passed.
      // The latest boundary that has passed is exactly that cutoff: anything
      // paid at or before it had a boundary no later than it.
      const boundary = boundaryAtOrBefore(
        timeBoundaries(policy.releaseTimes, 'SCHEDULED releaseTimes'),
        SETTLEMENT_TIMEZONE,
        now,
      );

      // Exclusive, so advance past the instant itself: a payment landing
      // exactly on a release time goes out in that batch.
      return boundary?.plus({ milliseconds: 1 }).toJSDate() ?? null;
    }

    case SettlementModeEnum.FIXED_DELAY: {
      assertDelayDays(policy);

      const boundary = boundaryAtOrBefore(
        timeBoundaries(policy.releaseTimes, 'FIXED_DELAY releaseTimes'),
        SETTLEMENT_TIMEZONE,
        now,
      );
      if (!boundary) return null;

      return shiftWholeDays(boundary, policy.delayDays).toJSDate();
    }

    case SettlementModeEnum.FOLLOW_UPSTREAM: {
      if (!window) return null;
      assertSettlementOffset(window);

      const boundary = boundaryAtOrBefore(
        upstreamBoundaries(window),
        window.timezone,
        now,
      );
      if (!boundary) return null;

      return shiftWholeDays(boundary, window.settlementOffset).toJSDate();
    }
  }
}

/**
 * The latest of `times` that has already happened - today's if one has, else
 * yesterday's last.
 *
 * Reaching back a day is the correct answer rather than an edge case to
 * tolerate: at 05:30, with batches at 06:00/12:00/18:00/23:00, the most recent
 * thing that should have settled is last night's 23:00.
 */
function boundaryAtOrBefore(
  build: BoundaryBuilder | null,
  zone: string,
  now: Date,
): DateTime | null {
  if (!build) return null;

  const at = inZone(now, zone, 'now');
  const today = at.startOf('day');

  const todays = build(today);
  const passed = todays.filter((b) => b.toMillis() <= at.toMillis());

  if (passed.length > 0) return passed[passed.length - 1];

  // Nothing today yet, so the most recent boundary was yesterday's last.
  const yesterdays = build(today.minus({ days: 1 }));

  return yesterdays[yesterdays.length - 1] ?? null;
}

/**
 * Builds a day's boundaries, ascending.
 *
 * A function rather than a list of `HH:mm` strings because one case cannot be
 * expressed as a clock time: an upstream window with no published settlement
 * time releases at `endOf('day')`, which is 23:59:59.999. Writing that as
 * `'23:59'` would put the boundary 59.999 seconds early, and a cutoff derived
 * from it would claim payments whose release moment has not actually passed -
 * paying a merchant before the upstream paid us, which is the one error this
 * whole design exists to prevent.
 */
type BoundaryBuilder = (day: DateTime) => DateTime[];

function timeBoundaries(
  times: readonly string[],
  what: string,
): BoundaryBuilder | null {
  if (times.length === 0) return null;

  const sorted = sortedTimes(times);

  return (day) => sorted.map((time) => atTimeOnDay(day, time, what));
}

/** One boundary a day: the partner's stated time, or the end of the day. */
function upstreamBoundaries(window: EligibilityWindow): BoundaryBuilder {
  const { settlementTime } = window;

  return settlementTime === null
    ? (day) => [day.endOf('day')]
    : (day) => [atTimeOnDay(day, settlementTime, 'settlementTime')];
}

/**
 * A day-aligned cutoff `days` whole days before `boundary`.
 *
 * `delayDays: 1` with a boundary of today 10:00 yields the start of today, so
 * everything paid yesterday or earlier is ripe and nothing paid today is.
 * `delayDays: 0` yields the start of tomorrow, so all of today counts.
 */
function shiftWholeDays(boundary: DateTime, days: number): DateTime {
  return boundary.startOf('day').minus({ days: days - 1 });
}

function currentSlot(now: Date): DateTime {
  const at = inZone(now, SETTLEMENT_TIMEZONE, 'now');
  const minute =
    Math.floor(at.minute / INSTANT_SLOT_MINUTES) * INSTANT_SLOT_MINUTES;

  return at.set({ minute, second: 0, millisecond: 0 });
}

function assertNoBusinessDays(policy: EligibilityPolicy): void {
  if (policy.businessDaysOnly) {
    throw new Error(
      'settlement: businessDaysOnly is set on this policy, but the business-day ' +
        'calendar is not implemented. Refusing to settle rather than release ' +
        'funds on a day the policy says to skip.',
    );
  }
}

function assertDelayDays(
  policy: EligibilityPolicy,
): asserts policy is EligibilityPolicy & { delayDays: number } {
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
}

function assertSettlementOffset(window: EligibilityWindow): void {
  if (
    !Number.isInteger(window.settlementOffset) ||
    window.settlementOffset < 0
  ) {
    throw new Error(
      `settlement: settlementOffset must be a non-negative whole number of days, got ${String(window.settlementOffset)}.`,
    );
  }
}
