import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionTypeEnum,
} from '@app/microservice';
import { randomBytes } from 'crypto';

type SystemReferenceDto = {
  userId: number;
  transactionType: TransactionTypeEnum;
  paymentMethodName: PaymentMethodNameEnum;
  providerName: ProviderNameEnum;
  createdAt: Date;
};

export const generateSystemReference = (
  dto: Omit<SystemReferenceDto, 'createdAt'> & { length?: number },
) => {
  // const { userId, transactionType, providerName, paymentMethodName } = dto;
  const userId = dto.userId;
  const transactionType = transactionTypeMapper(dto.transactionType); // 1
  const paymentMethodName = paymentMethodNameMapper(dto.paymentMethodName); // 2
  const providerName = providerNameMapper(dto.providerName); // 5
  const nowMs = Date.now(); // 13

  // 1 + 2 + 5 + 13 + 1 (delimiter) = 22
  const length = dto.length ?? 32;

  const systemReference = `${nowMs}${transactionType}${paymentMethodName}${providerName}-${userId}`;

  if (systemReference.length >= length - 1) return systemReference;
  const random = randomBytes(10).toString('hex');
  return `${systemReference}-${random.slice(0, length - systemReference.length - 1)}`;
};

export const extractSystemReference = (systemReference: string) => {
  // For Example: 1772001455392DTBPDNT1-13-[random]

  const match = systemReference.match(
    /^(\d{13})([A-Z0-9])([A-Z0-9]{2})([A-Z0-9]{5})-(\d+)(?:-([A-Za-z0-9]+))?$/,
  );

  if (!match) throw new Error('Invalid SystemReference ' + systemReference); // need discuss
  const [, nowMs, transactionType, paymentMethodName, providerName, userId] =
    match;

  const parsedUserId = Number(userId);
  const parsedDate = new Date(Number(nowMs));

  if (!Number.isInteger(parsedUserId) || Number.isNaN(parsedDate.getTime()))
    throw new Error('Invalid timestamp'); // Need discuss

  const dto: SystemReferenceDto = {
    userId: parsedUserId,
    transactionType: transactionTypeConvert(transactionType),
    paymentMethodName: paymentMethodConvert(paymentMethodName),
    providerName: providerNameConvert(providerName),
    createdAt: parsedDate,
  };
  return dto;
};

const transactionTypeMapper = (
  transactionType: TransactionTypeEnum,
): string => {
  if (TransactionTypeEnum.PURCHASE === transactionType) return 'P';
  if (TransactionTypeEnum.TOPUP === transactionType) return 'T';
  if (TransactionTypeEnum.WITHDRAW === transactionType) return 'W';
  if (TransactionTypeEnum.DISBURSEMENT === transactionType) return 'D';
  if (TransactionTypeEnum.SETTLEMENT_PURCHASE === transactionType) return 'S';
  return '0';
};

const transactionTypeConvert = (value: string): TransactionTypeEnum => {
  if ('P' === value) return TransactionTypeEnum.PURCHASE;
  if ('T' === value) return TransactionTypeEnum.TOPUP;
  if ('W' === value) return TransactionTypeEnum.WITHDRAW;
  if ('D' === value) return TransactionTypeEnum.DISBURSEMENT;
  if ('S' === value) return TransactionTypeEnum.SETTLEMENT_PURCHASE;
  else return TransactionTypeEnum.SETTLEMENT_PURCHASE;
};

const paymentMethodNameMapper = (
  paymentMethodName: PaymentMethodNameEnum,
): string => {
  if (PaymentMethodNameEnum.QRIS === paymentMethodName) return 'QR';
  if (PaymentMethodNameEnum.VIRTUALACCOUNT === paymentMethodName) return 'VA';
  if (PaymentMethodNameEnum.DIRECTEWALLET === paymentMethodName) return 'DE';
  if (PaymentMethodNameEnum.TRANSFERBANK === paymentMethodName) return 'TB';
  if (PaymentMethodNameEnum.TRANSFEREWALLET === paymentMethodName) return 'TE';
  return '0';
};

const paymentMethodConvert = (value: string): PaymentMethodNameEnum => {
  if (value === 'QR') return PaymentMethodNameEnum.QRIS;
  if (value === 'VA') return PaymentMethodNameEnum.VIRTUALACCOUNT;
  if (value === 'DE') return PaymentMethodNameEnum.DIRECTEWALLET;
  if (value === 'TB') return PaymentMethodNameEnum.TRANSFERBANK;
  if (value === 'TE') return PaymentMethodNameEnum.TRANSFEREWALLET;
  return PaymentMethodNameEnum.QRIS;
};

const providerNameMapper = (providerName: ProviderNameEnum): string => {
  if (ProviderNameEnum.INTERNAL === providerName) return 'INTER';
  if (ProviderNameEnum.MOTIONPAY === providerName) return 'MTNPY';
  return '00000';
};

const providerNameConvert = (value: string): ProviderNameEnum => {
  if (value === 'INTER') return ProviderNameEnum.INTERNAL;
  if (value === 'MTNPY') return ProviderNameEnum.MOTIONPAY;
  return ProviderNameEnum.INTERNAL;
};
