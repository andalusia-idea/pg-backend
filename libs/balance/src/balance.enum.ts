export const BalanceHolderTypeEnum = {
  INTERNAL: 'INTERNAL',
  AGENT: 'AGENT',
  MERCHANT: 'MERCHANT',
} as const;
export type BalanceHolderTypeEnum =
  (typeof BalanceHolderTypeEnum)[keyof typeof BalanceHolderTypeEnum];

export const BalanceBucketEnum = {
  PENDING: 'PENDING',
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
} as const;
export type BalanceBucketEnum =
  (typeof BalanceBucketEnum)[keyof typeof BalanceBucketEnum];

export const BalanceDirectionEnum = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
} as const;
export type BalanceDirectionEnum =
  (typeof BalanceDirectionEnum)[keyof typeof BalanceDirectionEnum];

export const BalanceReasonEnum = {
  PAYIN_CAPTURED: 'PAYIN_CAPTURED',
  /// Refund or chargeback: a new entry reversing PAYIN_CAPTURED, never an edit.
  /// Note the spelling - REVERSED, not RESERVED. Reservation is a payout
  /// concept (PAYOUT_RESERVED below); there is no such thing as reserving a
  /// payin, and the two words transpose easily enough to type-check silently.
  PAYIN_REVERSED: 'PAYIN_REVERSED',

  PAYOUT_RESERVED: 'PAYOUT_RESERVED',
  PAYOUT_COMPLETED: 'PAYOUT_COMPLETED',
  PAYOUT_FAILED: 'PAYOUT_FAILED',

  MERCHANT_SETTLED: 'MERCHANT_SETTLED',
  TOPUP_APPROVED: 'TOPUP_APPROVED',
  MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',
  OPENING_BALANCE: 'OPENING_BALANCE',
} as const;
export type BalanceReasonEnum =
  (typeof BalanceReasonEnum)[keyof typeof BalanceReasonEnum];

export const BalanceSourceTypeEnum = {
  PURCHASE: 'PURCHASE',
  DISBURSEMENT: 'DISBURSEMENT',
  WITHDRAW: 'WITHDRAW',
  TOPUP: 'TOPUP',
  ADJUSTMENT: 'ADJUSTMENT',
  OPENING: 'OPENING',
} as const;
export type BalanceSourceTypeEnum =
  (typeof BalanceSourceTypeEnum)[keyof typeof BalanceSourceTypeEnum];
