import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches, ValidationOptions } from 'class-validator';
import Decimal from 'decimal.js';

/**
 * Money crosses the API boundary as a plain string with a fixed 2 decimal places
 * ("10000.00"), never as a float - floats can't represent currency exactly.
 *
 * The integer part is capped at 13 digits to match `Decimal(15, 2)`, the width
 * every Money column uses (max 9,999,999,999,999.99 - roughly 10 trillion IDR).
 * Rejecting an over-wide amount here returns a 422 naming the field, rather than
 * letting Postgres raise a numeric-overflow the caller cannot act on.
 */
export const MONEY_INTEGER_DIGITS = 13;
export const MONEY_DECIMAL_PLACES = 2;
export const MONEY_PATTERN = new RegExp(
  `^\\d{1,${MONEY_INTEGER_DIGITS}}(\\.\\d{1,${MONEY_DECIMAL_PLACES}})?$`,
);
export const MONEY_EXAMPLE = '10000.00';

/**
 * Percentage columns are `Decimal(8, 4)`. The pattern caps the value at 100
 * regardless, since that is the business rule - the column is simply wide enough
 * not to constrain it.
 *
 * The scale stays parameterised in case a 2-decimal percentage ever appears, but
 * every percentage column in the current schema is 4.
 */
export const PERCENTAGE_DECIMAL_PLACES = 4;

export function percentagePattern(
  decimalPlaces: 2 | 4 = PERCENTAGE_DECIMAL_PLACES,
): RegExp {
  return new RegExp(
    `^(100(\\.0{1,${decimalPlaces}})?|\\d{1,2}(\\.\\d{1,${decimalPlaces}})?)$`,
  );
}

/**
 * True for objects that override Object.prototype.toString - i.e. ones whose
 * String() yields something meaningful rather than "[object Object]".
 *
 * Needed because Prisma bundles its own decimal.js copy: a Decimal read from the
 * database fails `instanceof` against ours, but its toString() is always the
 * plain numeric form, which the Decimal constructor accepts unambiguously.
 */
function hasMeaningfulToString(
  value: unknown,
): value is { toString(): string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.toString !== Object.prototype.toString
  );
}

/** Renders any value for an error message without risking "[object Object]". */
function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (hasMeaningfulToString(value)) return value.toString();
  return JSON.stringify(value) ?? 'unknown';
}

function toDecimal(value: unknown): Decimal {
  if (value instanceof Decimal) return value;

  const raw = hasMeaningfulToString(value) ? value.toString() : value;

  return new Decimal(raw as Decimal.Value);
}

function toFixedString(value: unknown, decimalPlaces: number): string | null {
  if (value === null || value === undefined || value === '') return null;

  try {
    return toDecimal(value).toFixed(decimalPlaces);
  } catch {
    throw new Error(`Invalid decimal value: ${describe(value)}`);
  }
}

/**
 * Response side: serializes a Prisma Decimal (or string/number) to a fixed-2 string.
 * Runs under the globally registered ClassSerializerInterceptor.
 */
export function ToMoneyString() {
  return Transform(({ value }) => toFixedString(value, 2), {
    toPlainOnly: true,
  });
}

/** Response side, for percentage columns. Scale must match the Prisma column. */
export function ToPercentageString(
  decimalPlaces: 2 | 4 = PERCENTAGE_DECIMAL_PLACES,
) {
  return Transform(({ value }) => toFixedString(value, decimalPlaces), {
    toPlainOnly: true,
  });
}

/** Request side: accepts "10000", "10000.5" or "10000.50". */
export function IsMoney(validationOptions?: ValidationOptions) {
  return applyDecorators(
    IsString(validationOptions),
    Matches(MONEY_PATTERN, {
      message: ({ property }) =>
        `${property} must be a decimal string with up to 2 decimal places (e.g. "${MONEY_EXAMPLE}")`,
      ...validationOptions,
    }),
  );
}

/** Request side: 0-100 with up to `decimalPlaces` decimals. */
export function IsPercentage(
  decimalPlaces: 2 | 4 = PERCENTAGE_DECIMAL_PLACES,
  validationOptions?: ValidationOptions,
) {
  return applyDecorators(
    IsString(validationOptions),
    Matches(percentagePattern(decimalPlaces), {
      message: ({ property }) =>
        `${property} must be a percentage string between 0 and 100 with up to ${decimalPlaces} decimal places`,
      ...validationOptions,
    }),
  );
}
