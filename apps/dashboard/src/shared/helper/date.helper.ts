import 'dotenv/config';
import { DateTime } from 'luxon';

/**
 * Timezone-aware date handling for the dashboard's own API surface.
 *
 * Deliberately app-local rather than a shared lib: the transactional backends
 * have to speak whatever date format each upstream provider / PJP mandates,
 * which differs per integration. This helper only ever serves the internal
 * dashboard and its frontend, so it can assume one timezone throughout.
 *
 * Read from the environment rather than injected config because the DTO
 * transform decorators are plain functions, outside Nest's DI graph.
 */
const TIMEZONE = process.env.TIMEZONE || 'Asia/Jakarta';

export class DateHelper {
  static get timezone(): string {
    return TIMEZONE;
  }

  static now(): DateTime {
    return DateTime.now().setZone(TIMEZONE);
  }

  static nowMs(): number {
    return DateTime.now().toMillis();
  }

  static nowJSDate(): Date {
    return this.now().toJSDate();
  }

  /**
   * Now, truncated to the second - the precision this API actually serves.
   *
   * `ToJakartaISO` formats `yyyy-MM-dd'T'HH:mm:ssZZ`, dropping milliseconds on
   * purpose to match the gateway convention. So a value stored *with*
   * milliseconds is served truncated, and a client posting back what it was
   * given is naming a different instant than the one stored.
   *
   * That is harmless for a timestamp nobody addresses, and a defect for one
   * that is part of a natural key: the row becomes impossible to restate, so
   * an upsert keyed on it inserts a second row instead of correcting the first.
   * Measured on `MerchantSettlementPolicy`, whose unique key is
   * `(merchantId, paymentMethodName, effectiveFrom)` - every registration
   * default was uncorrectable through the API for this reason.
   *
   * Use this wherever the clock feeds a column a client will later have to
   * name, and `nowJSDate()` for everything else. It does not help a date the
   * *client* sends: `ToJsDate` keeps whatever precision arrives, so a caller
   * that posts milliseconds of its own can still write a row it cannot name.
   */
  static nowAtApiPrecision(): Date {
    return this.now().startOf('second').toJSDate();
  }

  static from(value: Date | string | DateTime): DateTime {
    if (value instanceof Date) return DateTime.fromJSDate(value);
    if (typeof value === 'string') return DateTime.fromISO(value);
    return value;
  }

  static fromISO(value: string): DateTime {
    return DateTime.fromISO(value, { zone: TIMEZONE });
  }

  static fromJsDate(date: Date | null): DateTime | null {
    if (!date) return null;
    return DateTime.fromJSDate(date).setZone(TIMEZONE);
  }

  static fromMs(date: number | string): DateTime {
    const dateNumber: number = typeof date === 'string' ? Number(date) : date;
    return DateTime.fromMillis(dateNumber, { zone: TIMEZONE });
  }

  /** e.g. "2026-08-10T17:32:41.000+07:00" - includes milliseconds. */
  static nowISO(): string {
    return this.now().toISO() ?? this.now().toString();
  }

  /** e.g. "2026-08-10T17:32:41.000+07:00" - includes milliseconds. */
  static toISO(date: Date | string | DateTime): string | null {
    if (date instanceof DateTime) return date.setZone(TIMEZONE).toISO();
    if (date instanceof Date) {
      return DateTime.fromJSDate(date).setZone(TIMEZONE).toISO();
    }
    return DateTime.fromISO(date, { zone: TIMEZONE }).toISO();
  }
}
