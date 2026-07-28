import { Transform } from 'class-transformer';
import Decimal from 'decimal.js';

/**
 * Money fields cross this library as Decimal, never number/float - avoids
 * floating-point rounding errors on fee calculations.
 */
export function ToDecimal() {
  return Transform(({ value, key }) => {
    if (value instanceof Decimal) return value;
    try {
      return new Decimal(value as Decimal.Value);
    } catch {
      throw new Error(`Invalid decimal value for "${String(key)}": ${value}`);
    }
  });
}

/** Serializes a Decimal to a fixed-2-places string when the DTO is sent out. */
export function ToDecimalFixed() {
  return Transform(
    ({ value }) => {
      if (value === null || value === undefined || value === '') return null;

      let decimal = value as Decimal;
      if (!(decimal instanceof Decimal)) {
        try {
          decimal = new Decimal(value as Decimal.Value);
        } catch {
          throw new Error(`Invalid decimal value: ${String(value)}`);
        }
      }

      return decimal.toFixed(2);
    },
    { toPlainOnly: true },
  );
}
