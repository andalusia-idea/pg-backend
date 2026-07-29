/** Default timeout for a TCP call before it's treated as failed. */
export const MICROSERVICE_CALL_TIMEOUT_MS = 5000;

export const AUTH_CLIENT = Symbol('AUTH_CLIENT');
export const CONFIG_CLIENT = Symbol('CONFIG_CLIENT');
export const TRANSACTION_CLIENT = Symbol('TRANSACTION_CLIENT');

export const CONFIG_CMD = {
  CALCULATE_FEE_PURCHASE: 'calculate_fee_purchase',
  CALCULATE_FEE_WITHDRAW: 'calculate_fee_withdraw',
  CALCULATE_FEE_TOPUP: 'calculate_fee_topup',
  CALCULATE_FEE_DISBURSEMENT: 'calculate_fee_disbursement',
} as const;
