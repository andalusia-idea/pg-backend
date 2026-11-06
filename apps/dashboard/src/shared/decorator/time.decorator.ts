import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptions } from '@nestjs/swagger';
import { IsString, Matches, ValidationOptions } from 'class-validator';

/**
 * A wall-clock time of day, `"HH:MM"` on a 24-hour clock, read in the row's own
 * `timezone` column.
 *
 * Deliberately not a timestamp. These columns say *when in the day* a partner's
 * window opens or their money lands - a recurring rule, not an instant - so
 * `ToJakartaISO` and friends do not apply here.
 *
 * `"24:00"` is rejected even though the reference tables in
 * `docs/accounting/upstream-settlement-schedules.md` write it that way.
 * `UpstreamSettlementWindow` expresses a full day as `windowEnd` equal to
 * `windowStart` - the engine seed writes `00:00`/`00:00` for both MotionPay
 * rails - and accepting a second spelling of the same thing would put two rows
 * in the table that look different and behave identically.
 */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TIME_OF_DAY_EXAMPLE = '13:00';

/** Minutes in a day, the unit window arithmetic is done in. */
export const MINUTES_PER_DAY = 24 * 60;

/** Request side. */
export function IsTimeOfDay(validationOptions?: ValidationOptions) {
  return applyDecorators(
    IsString(validationOptions),
    Matches(TIME_OF_DAY_PATTERN, {
      message: ({ property }) =>
        `${property} must be a 24-hour time of day as "HH:MM" (e.g. "${TIME_OF_DAY_EXAMPLE}"); ` +
        `a full day is written as windowEnd equal to windowStart, not "24:00"`,
      ...validationOptions,
    }),
  );
}

export function ApiTimeOfDayProperty(options?: ApiPropertyOptions) {
  return ApiProperty({
    type: String,
    pattern: TIME_OF_DAY_PATTERN.source,
    example: TIME_OF_DAY_EXAMPLE,
    ...options,
  });
}

/** `"18:30"` -> 1110. Assumes the value already passed `IsTimeOfDay`. */
export function timeOfDayToMinutes(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}
