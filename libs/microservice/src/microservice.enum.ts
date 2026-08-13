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

export const UserRoleEnum = {
  ADMIN: 'ADMIN',
  AGENT: 'AGENT',
  MERCHANT: 'MERCHANT',
} as const;
export type UserRoleEnum = (typeof UserRoleEnum)[keyof typeof UserRoleEnum];

export const ProviderNameEnum = {
  INTERNAL: 'INTERNAL',
  MOTIONPAY: 'MOTIONPAY',
  // INACASH: 'INACASH',
  // PDNT1: 'PDNT1',
  // ZIPAY: 'ZIPAY',
  // PAKAIDONK: 'PAKAIDONK',
} as const;
export type ProviderNameEnum =
  (typeof ProviderNameEnum)[keyof typeof ProviderNameEnum];

export const PaymentMethodNameEnum = {
  QRIS: 'QRIS',
  VIRTUALACCOUNT: 'VIRTUALACCOUNT',
  DIRECTEWALLET: 'DIRECTEWALLET',
  TRANSFERBANK: 'TRANSFERBANK',
  TRANSFEREWALLET: 'TRANSFEREWALLET',
} as const;
export type PaymentMethodNameEnum =
  (typeof PaymentMethodNameEnum)[keyof typeof PaymentMethodNameEnum];

export const TransactionTypeEnum = {
  WITHDRAW: 'WITHDRAW',
  TOPUP: 'TOPUP',
  DISBURSEMENT: 'DISBURSEMENT',
  PURCHASE: 'PURCHASE',
  SETTLEMENT_PURCHASE: 'SETTLEMENT_PURCHASE',
} as const;
export type TransactionTypeEnum =
  (typeof TransactionTypeEnum)[keyof typeof TransactionTypeEnum];
