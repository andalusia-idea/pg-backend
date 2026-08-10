import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, Matches, ValidationOptions } from 'class-validator';
import Decimal from 'decimal.js';

/**
 * Money crosses the API boundary as a plain string with a fixed 2 decimal places
 * ("10000.00"), never as a float - floats can't represent currency exactly.
 *
 * Mirrors the TypeBox `MoneyType` used by the Fastify apps
 * (libs/microservice/src/microservice.enum.ts) so both stacks accept the same input.
 */
export const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;
export const MONEY_EXAMPLE = '10000.00';

/**
 * Percentages allow a configurable scale because the columns disagree:
 * BaseFee.feeProviderPercentage is Decimal(10,2) while
 * MerchantFee.feeInternalPercentage / feeAgentPercentage are Decimal(10,4).
 * Validating everything at 2 would silently truncate merchant fee config.
 */
export function percentagePattern(decimalPlaces: 2 | 4 = 2): RegExp {
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
export function ToPercentageString(decimalPlaces: 2 | 4 = 2) {
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
  decimalPlaces: 2 | 4 = 2,
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
