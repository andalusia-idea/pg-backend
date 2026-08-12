/**
 * Selector for the `common/div` lookup. Most values are not rows in
 * `config.Common` at all - they route to Bank, Provider or PaymentMethod - so
 * this is a query selector rather than a column value.
 */
export const CommonDiv = {
  BANK: 'BANK',
  PROVIDER: 'PROVIDER',
  PROVIDER_TOPUP: 'PROVIDER_TOPUP',
  PAYMENT_METHOD: 'PAYMENT_METHOD',
  PAYMENT_METHOD_PURCHASE: 'PAYMENT_METHOD_PURCHASE',
  PAYMENT_METHOD_TOPUP: 'PAYMENT_METHOD_TOPUP',
  PAYMENT_METHOD_DISBURSEMENT: 'PAYMENT_METHOD_DISBURSEMENT',
  PAYMENT_METHOD_WITHDRAW: 'PAYMENT_METHOD_WITHDRAW',
} as const;
export type CommonDiv = (typeof CommonDiv)[keyof typeof CommonDiv];

/** The only provider that can fund a top-up. */
export const INTERNAL_PROVIDER_NAME = 'INTERNAL';
