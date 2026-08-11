import { Transform } from 'class-transformer';
import { ApiError } from '../exception';
import { DateHelper } from '../helper/date.helper';

/**
 * Dates cross the API boundary as ISO 8601 strings carrying an explicit Jakarta
 * offset - "2026-08-10T17:32:41+07:00" - matching the convention used by the
 * Indonesian payment gateways this system integrates with (DANA, Midtrans) and
 * the same family of format SNAP mandates for X-TIMESTAMP.
 *
 * The DTO field is typed as the wire type (string) rather than a Luxon DateTime,
 * so there is no gap between what the type says and what the client receives.
 */
export const DATE_EXAMPLE = '2026-08-10T17:32:41+07:00';

/** Serialization-only: these transforms must not run on incoming payloads. */
const PLAIN_ONLY = { toPlainOnly: true } as const;

/**
 * Second precision with an explicit offset. Luxon's toISO() appends milliseconds
 * (".000"), which the gateway convention this mirrors does not use - and
 * `suppressMilliseconds` only drops them when they happen to be zero, so the
 * shape would vary row to row. An explicit format keeps every timestamp identical.
 */
const API_DATE_FORMAT = "yyyy-MM-dd'T'HH:mm:ssZZ";

/** DateHelper.fromJsDate already applies the configured timezone. */
function formatJakarta(value: Date): string | null {
  return DateHelper.fromJsDate(value)?.toFormat(API_DATE_FORMAT) ?? null;
}

function parseIso(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;

  const dateTime = DateHelper.fromISO(value);
  return dateTime.isValid ? dateTime.toJSDate() : null;
}

/** Response side: JS Date (from Prisma) -> ISO string with +07:00. */
export function ToJakartaISO() {
  return Transform(({ value, key }) => {
    const formatted = value instanceof Date ? formatJakarta(value) : null;
    if (formatted === null) throw ApiError.invalidDate(String(key), value);
    return formatted;
  }, PLAIN_ONLY);
}

/** Response side, nullable. */
export function ToJakartaISONullable() {
  return Transform(({ value }) => {
    if (!(value instanceof Date)) return null;
    return formatJakarta(value);
  }, PLAIN_ONLY);
}

/**
 * Request side: ISO string -> JS Date, which is what Prisma expects.
 *
 * Validation happens inside the transform rather than via a class-validator rule
 * because Nest's ValidationPipe runs class-transformer first - by the time
 * validators execute the value is already a Date, so `@IsISO8601()` would
 * reject its own transformed output.
 */
export function ToJsDate() {
  return Transform(({ value, key }) => {
    const parsed = parseIso(value);
    if (parsed === null) throw ApiError.invalidDate(String(key), value);
    return parsed;
  });
}

/** Request side, nullable - absent/empty means "no filter". */
export function ToJsDateNullable() {
  return Transform(({ value, key }) => {
    if (value === null || value === undefined || value === '') return null;

    const parsed = parseIso(value);
    if (parsed === null) throw ApiError.invalidDate(String(key), value);
    return parsed;
  });
}
