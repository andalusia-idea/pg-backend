import { EWalletEnum, TransactionStatusEnum } from '@app/microservice';

export const JATELINDO_ENDPOINT = {
  /// Transfer
  LOGIN: '/Host/Transfer/Session/Login',
  BALANCE_INQUIRY: '/Host/Transfer/Account/BalanceInquiry',
  INQUIRY: '/Host/Transfer/Transaction/Inquiry',
  SINGLE_TRANSFER: '/Host/Transfer/Transaction/SingleTransfer',
  TRANSACTION_STATUS: '/Host/Transfer/Transaction/Status',
};

export const JATELINDO_RESPONSE_CODE = {
  PROCESSED: 'A00',
  REQUESTED: 'A01',
  DUPLICATE_TRANSACTION: 'P16',
  TRANSACTION_FAILED: 'T40',
  TRANSACTION_BLOCKED: 'T40',
  INACTIVE_ACCOUNT: 'S14',
  TRANSACTION_AMOUNT_ABOVE_LIMIT: 'T18',
  TRANSACTION_REJECTED: 'T40',
  TRANSACTION_AMOUNT_BELOW_LIMIT: 'T16',
  INVALID_ACCOUNT: 'S14',
  UNKNOWN_ERROR: 'E99',
  TIMEOUT: 'E18',
  UNAUTHORIZED_ACCESS: 'A90',
  NO_TRANSACTION: 'S84',
  /// TODO complete the rest
} as const;
export type JATELINDO_RESPONSE_CODE =
  (typeof JATELINDO_RESPONSE_CODE)[keyof typeof JATELINDO_RESPONSE_CODE];

export const jatelindoMapperResponseCode = (
  responseCode: JATELINDO_RESPONSE_CODE,
): TransactionStatusEnum => {
  switch (responseCode) {
    case 'A00':
      return TransactionStatusEnum.SUCCESS;
    case 'A01':
      return TransactionStatusEnum.PENDING;
    case 'P16':
      return TransactionStatusEnum.FAILED;
    case 'S14':
      return TransactionStatusEnum.FAILED;
    case 'T18':
      return TransactionStatusEnum.CANCELLED;
    case 'T16':
      return TransactionStatusEnum.CANCELLED;
    case 'E99':
      return TransactionStatusEnum.CANCELLED;
    case 'E18':
      return TransactionStatusEnum.EXPIRED;
    case 'A90':
      return TransactionStatusEnum.CANCELLED;
    case 'S84':
      return TransactionStatusEnum.FAILED;
    case 'T40':
      return TransactionStatusEnum.FAILED;
    default:
      return TransactionStatusEnum.FAILED;
  }
};

export const JATELINDO_CHANNEL = {
  [EWalletEnum.DANA]: 'DANA',
  [EWalletEnum.SHOPEEPAY]: 'SHOPEEPAY',
  [EWalletEnum.GOPAY]: 'GOPAY',
  [EWalletEnum.OVO]: 'OVO',
  '013': '2', // PT. BANK PERMATA Tbk.
  '008': '3', // PT. BANK MANDIRI Tbk.
  /// TODO complete the rest
} as const;
