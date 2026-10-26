import { DateTime } from 'luxon';

/**
 * Time handling shared by every policy calculation.
 *
 * Extracted so `policy.eligibility.ts` (when does *this payment* release?) and
 * `policy.due-at.ts` (when is *this merchant* next due?) cannot drift on the
 * format they accept or the zone they read. They answer different questions
 * from the same columns, and a disagreement between them would mean the
 * enqueuer creating runs for boundaries the claim does not recognise.
 */

/**
 * Every policy mode is answered in Jakarta time.
 *
 * A constant rather than `process.env.TIMEZONE`, unlike the dashboard's
 * `DateHelper`. A merchant's settlement schedule is a contractual term in local
 * Indonesian time; it does not change because a container was redeployed
 * somewhere else, and these functions are pure, so reading the environment
 * would make the same inputs produce different answers per deployment.
 *
 * `UpstreamSettlementWindow` carries its own `timezone` because a partner's
 * published schedule is in *their* timezone, which is theirs to state.
 */
export const SETTLEMENT_TIMEZONE = 'Asia/Jakarta';

/** `HH:mm`, 24-hour, zero-padded - so lexicographic order is chronological. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTimeOfDay(
  value: string,
  what: string,
): { hour: number; minute: number } {
  const match = TIME_OF_DAY.exec(value);

  if (!match) {
    throw new Error(
      `settlement: ${what} must be zero-padded HH:mm in 24-hour form, got "${value}".`,
    );
  }

  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** The given clock time on the given day, seconds and below cleared. */
export function atTimeOnDay(
  day: DateTime,
  time: string,
  what: string,
): DateTime {
  const { hour, minute } = parseTimeOfDay(time, what);

  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

/** Read an instant in a named zone, refusing an unknown one rather than falling back. */
export function inZone(when: Date, zone: string, what: string): DateTime {
  const result = DateTime.fromJSDate(when, { zone });

  if (!result.isValid) {
    throw new Error(
      `settlement: cannot read ${what} in zone "${zone}" - ${result.invalidReason ?? 'invalid'}.`,
    );
  }

  return result;
}

/**
 * Zero-padded `HH:mm` sorted chronologically, which for this format is just
 * text order - that is what the padding in `TIME_OF_DAY` buys.
 */
export function sortedTimes(times: readonly string[]): string[] {
  return [...times].sort();
}
