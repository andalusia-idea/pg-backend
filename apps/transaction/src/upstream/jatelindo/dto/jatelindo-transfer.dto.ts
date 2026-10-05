import { Static, Type } from '@sinclair/typebox';

/// Balance Inquiry
export const JatelindoBalanceInquiryResponseSchema = Type.Object({
  BalanceInquiryResponse: Type.Array(
    Type.Object({
      accountBalance: Type.String(),
      reservedAmount: Type.String(),
      member: Type.Object({
        name: Type.String(),
        username: Type.String(),
      }),
      account: Type.Object({
        name: Type.String(),
        id: Type.String(),
      }),
    }),
  ),
  status: Type.Object({
    responseCode: Type.String(),
    message: Type.String(),
    description: Type.String(),
  }),
});
export type JatelindoBalanceInquiryResponseDto = Static<
  typeof JatelindoBalanceInquiryResponseSchema
>;

/// Transaction History
export const JatelindoTransactionHistoryRequestSchema = Type.Object({
  fromDate: Type.String(),
  toDate: Type.String(),
});
export type JatelindoTransactionHistoryRequestDto = Static<
  typeof JatelindoTransactionHistoryRequestSchema
>;
export const JatelindoTransactionHistoryResponseSchema = Type.Object({
  TransactionHistoryResponse: Type.Array(
    Type.Object({
      amount: Type.String(),
      traceNumber: Type.String(),
      transactionNumber: Type.String(),
      transactionDate: Type.String(),
      transactionType: Type.Object({ name: Type.String() }),
      sourceAccount: Type.Object({
        name: Type.String(),
        username: Type.String(),
      }),
      destinationAccount: Type.Object({
        name: Type.String(),
        username: Type.String(),
      }),
    }),
  ),
  status: Type.Object({
    responseCode: Type.String(),
    message: Type.String(),
    description: Type.String(),
  }),
});
export type JatelindoTransactionHistoryResponseDto = Static<
  typeof JatelindoTransactionHistoryResponseSchema
>;

/// Inquiry
export const JatelindoInquiryRequestSchema = Type.Object({
  accountNo: Type.String(),
  amount: Type.String(),
  channelId: Type.String(),
  description: Type.Union([Type.Null(), Type.String()]),
  phoneNo: Type.String(),
  name: Type.String(),
  email: Type.Union([Type.Null(), Type.String()]),
});
export type JatelindoInquiryRequestDto = Static<
  typeof JatelindoInquiryRequestSchema
>;
export const JatelindoInquiryResponseSchema = Type.Object({
  inquiryInfo: Type.Object({
    accountName: Type.String(),
    accountNo: Type.String(),
    bankName: Type.String(),
    customerAdmin: Type.String(),
  }),
  referenceID: Type.String(),
  status: Type.Object({
    responseCode: Type.String(),
    message: Type.String(),
    description: Type.String(),
  }),
});
export type JatelindoInquiryResponseDto = Static<
  typeof JatelindoInquiryResponseSchema
>;

/// Single Transfer
export const JatelindoSingleTransferRequestSchema = Type.Object({
  accountNo: Type.String(),
  traceNumber: Type.String(),
  amount: Type.String(),
  channelId: Type.String(),
  description: Type.Union([Type.Null(), Type.String()]),
  phoneNo: Type.String(),
  name: Type.String(),
  email: Type.Union([Type.Null(), Type.String()]),
});
export type JatelindoSingleTransferRequestDto = Static<
  typeof JatelindoSingleTransferRequestSchema
>;
export const JatelindoSingleTransferResponseSchema = Type.Object({
  DisbursementResponse: Type.Array(
    Type.Object({
      transactionType: Type.Object({ name: Type.String() }),
      traceNumber: Type.String(),
      sourceAccount: Type.Object({
        fromName: Type.String(),
        fromUsername: Type.String(),
      }),
      transactionNumber: Type.String(),
      destinationAccount: Type.Object({
        accountName: Type.String(),
        accountNo: Type.String(),
        bankName: Type.String(),
      }),
    }),
  ),
  traceNumber: Type.String(),
  jpaReferenceNo: Type.String(),
  status: Type.Object({
    responseCode: Type.String(),
    message: Type.String(),
    description: Type.String(),
  }),
});
export type JatelindoSingleTransferResponseDto = Static<
  typeof JatelindoSingleTransferResponseSchema
>;

/// Transaction Status
export const JatelindoTransactionStatusRequestSchema = Type.Object({
  traceNumber: Type.String(),
});
export type JatelindoTransactionStatusRequestDto = Static<
  typeof JatelindoTransactionStatusRequestSchema
>;
export const JatelindoTransactionStatusResponseSchema = Type.Object({
  traceNumber: Type.String(),
  jpaReferenceNo: Type.String(),
  TransactionStatusResponse: Type.Array(
    Type.Object({
      traceNumber: Type.String(),
      transactionNumber: Type.String(),
      description: Type.Union([Type.Null(), Type.String()]),
      transactionDate: Type.String(),
      transactionState: Type.String(),
      destinationAccount: Type.Object({
        accountName: Type.String(),
        accountNo: Type.String(),
        bankName: Type.String(),
      }),
    }),
  ),
  status: Type.Object({
    responseCode: Type.String(),
    message: Type.String(),
    description: Type.String(),
  }),
});
export type JatelindoTransactionStatusResponseDto = Static<
  typeof JatelindoTransactionStatusResponseSchema
>;
