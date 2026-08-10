import { ApiProperty, ApiPropertyOptions } from '@nestjs/swagger';
import { DATE_EXAMPLE } from './date.decorator';
import {
  MONEY_EXAMPLE,
  MONEY_PATTERN,
  percentagePattern,
} from './money.decorator';

/**
 * Money fields render as the string they actually are on the wire.
 *
 * Deliberately not `@ApiProperty({ type: Decimal })`: @nestjs/swagger introspects
 * Decimal as a model class, and since decimal.js exposes no decorated members the
 * generated schema collapses to an empty object - which tells a frontend developer
 * the field is an object when it is really "10000.00".
 *
 * If the literal `type: Decimal` form is ever preferred, changing it here updates
 * every money field in the app.
 */
export function ApiMoneyProperty(options?: ApiPropertyOptions) {
  return ApiProperty({
    type: String,
    format: 'decimal',
    pattern: MONEY_PATTERN.source,
    example: MONEY_EXAMPLE,
    ...options,
  });
}

export function ApiPercentageProperty(
  decimalPlaces: 2 | 4 = 2,
  options?: ApiPropertyOptions,
) {
  return ApiProperty({
    type: String,
    format: 'decimal',
    pattern: percentagePattern(decimalPlaces).source,
    example: decimalPlaces === 4 ? '2.5000' : '2.50',
    ...options,
  });
}

/** ISO 8601 with an explicit Jakarta offset. */
export function ApiDateProperty(options?: ApiPropertyOptions) {
  return ApiProperty({
    type: String,
    format: 'date-time',
    example: DATE_EXAMPLE,
    ...options,
  });
}
