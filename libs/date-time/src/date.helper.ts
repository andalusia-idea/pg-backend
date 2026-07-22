import 'dotenv/config';
import { DateTime } from 'luxon';
// import { TIMEZONE } from '../constant/global.constant';

const TIMEZONE = process.env.TIMEZONE || 'Asia/Jakarta';

/**
 * Centralized helper for all date/time operations with timezone awareness.
 * Ensures all services consistently use the configured TIMEZONE (e.g. Asia/Jakarta).
 */
export class DateHelper {
  static now(): DateTime {
    return DateTime.now().setZone(TIMEZONE);
  }

  static nowMs(): number {
    return DateTime.now().toMillis();
  }

  static nowJSDate(): Date {
    return this.now().toJSDate();
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

  /**
   * Returns an ISO8601 timestamp string with timezone, e.g. "2025-08-01T14:30:45+07:00".
   * Suitable for APIs or external integrations (e.g. DANA, payment gateways).
   */
  static nowISO(): string {
    return this.now().toISO() ?? this.now().toString(); // e.g. "2025-08-01T14:30:45+07:00"
  }

  /**
   * Converts a JS Date to ISO8601 with timezone.
   */
  static toISO(date: Date | string | DateTime): string | null {
    if (date instanceof DateTime) return date.setZone(TIMEZONE).toISO();
    if (date instanceof Date)
      return DateTime.fromJSDate(date).setZone(TIMEZONE).toISO();
    return DateTime.fromISO(date, { zone: TIMEZONE }).toISO();
  }
}
