import { Type } from '@sinclair/typebox';

export const MoneyType = Type.String({
  pattern: '^\\d+(\\.\\d{1,2})?$',
  minLength: 1,
  maxLength: 32,
});

export const PercentageType = Type.String({
  pattern: `^(100(\\.0{1,2})?|[0-9]{1,2}(\\.\\d{1,2})?)$`,
  minLength: 1,
  maxLength: 8,
});

// export function PercentageType(decimalPlaces: 2 | 4 = 2) {
//   return Type.String({
//     pattern: `^(100(\\.0{1,${decimalPlaces}})?|[0-9]{1,2}(\\.\\d{1,${decimalPlaces}})?)$`,
//     minLength: 1,
//     maxLength: 8,
//   });
// }
