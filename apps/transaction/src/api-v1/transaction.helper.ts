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

/**
 * How long a reference we aim for when the upstream leaves us the room.
 *
 * A target, not a limit. Every provider we talk to today accepts far more —
 * MotionPay's QRIS `external_id` is a probed 255 — so the number is ours to
 * pick: long enough that the random tail carries real entropy, short enough to
 * stay readable in a log line.
 */
export const DEFAULT_SYSTEM_REFERENCE_LENGTH = 32;

/**
 * `{13 timestamp}{1 type}{2 method}{5 provider}` — everything ahead of
 * `-{userId}`.
 *
 * Fixed width by construction, and that is the whole trick: because no part
 * varies in length, `extractSystemReference` can read them back out without
 * any delimiter between them.
 */
const STRUCTURED_PREFIX_LENGTH = 21;

/**
 * The narrowest a structured reference can possibly be — the prefix, a
 * delimiter, and a single-digit user id.
 *
 * Below this the pattern cannot be expressed at all, which is what sends
 * generation down the random path.
 */
export const MIN_STRUCTURED_REFERENCE_LENGTH = STRUCTURED_PREFIX_LENGTH + 2;

/**
 * Reads a structured reference back apart.
 *
 * Deliberately **permissive about the random tail** (`[A-Za-z0-9]`) while
 * generation is strict (hex only). A reference written by an older or
 * different encoding still parses; nothing we write today can fail to.
 */
const STRUCTURED_PATTERN =
  /^(\d{13})([A-Z0-9])([A-Z0-9]{2})([A-Z0-9]{5})-(\d+)(?:-([A-Za-z0-9]+))?$/;

/**
 * Random hex of exactly `length` characters.
 *
 * Hex rather than base64url on purpose: the alphabet contains no `-`, so a
 * fully random reference can never accidentally satisfy `STRUCTURED_PATTERN`
 * (which requires a `-` followed by digits). That is what keeps the two kinds
 * of reference distinguishable without spending a character on a marker.
 */
const randomHex = (length: number): string =>
  randomBytes(Math.ceil(length / 2))
    .toString('hex')
    .slice(0, length);

/**
 * Build the correlation key for a transaction, sized to what the upstream that
 * will carry it actually accepts.
 *
 * **`maxLength` is a hard cap, and it is required.** The old `length` argument
 * was a soft target that could not enforce anything — asking for 21 returned
 * 24, because the structured part is 23 characters at its shortest and the
 * function simply handed it back whole. Since this value ends up as
 * `external_id` on the wire for Transfer and Biller, a limit that silently
 * fails to hold is worse than no limit: the request is built, sent, and
 * rejected by the provider after we have already reserved the row.
 *
 * Requiring the argument is the other half of that. There is no sensible
 * default, because only the adapter about to make the call knows its own
 * field width — a default would just be this file guessing on their behalf.
 *
 * **When the pattern does not fit, it is abandoned rather than trimmed.** A
 * truncated structured reference is the worst of both: it still looks
 * parseable, so it reads back as a transaction that never happened. The whole
 * budget goes to entropy instead, and `extractSystemReference` says plainly
 * that there is nothing to read.
 */
export const generateSystemReference = (
  dto: Omit<SystemReferenceDto, 'createdAt'> & { maxLength: number },
): string => {
  const { maxLength } = dto;

  // A programming error, not a runtime condition. An empty or negative budget
  // would produce an empty reference, and that value goes straight into a
  // `@unique` column as the key every callback is matched on.
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new Error(
      `generateSystemReference: maxLength must be a positive integer, got [${maxLength}]`,
    );
  }

  const transactionType = transactionTypeMapper(dto.transactionType); // 1
  const paymentMethodName = paymentMethodNameMapper(dto.paymentMethodName); // 2
  const providerName = providerNameMapper(dto.providerName); // 5
  const nowMs = Date.now(); // 13
  const userId = dto.userId; // 1 - 4 (depend on auto generated id from database)

  // 13 + 1 + 2 + 5 = 21, plus the delimiter and the user id: 23 at minimum.
  const structured = `${nowMs}${transactionType}${paymentMethodName}${providerName}-${userId}`;

  if (structured.length > maxLength) return randomHex(maxLength);

  // Never longer than we want just because the provider would tolerate it.
  const target = Math.min(maxLength, DEFAULT_SYSTEM_REFERENCE_LENGTH);

  // What is left after the structured part and its delimiter. Non-positive
  // means the pattern fills the budget exactly, or overruns our own target
  // because the user id is unusually long — either way it stands alone.
  const suffixLength = target - structured.length - 1;
  if (suffixLength < 1) return structured;

  return `${structured}-${randomHex(suffixLength)}`;
};

/**
 * What a reference turned out to be.
 *
 * A discriminated union rather than a nullable DTO because "this is random"
 * is a real, expected answer now — not a parse failure. The caller has to
 * decide what to do about it, and a `null` would let them forget.
 */
export type SystemReferenceParts =
  | ({ pattern: 'structured' } & SystemReferenceDto)
  | { pattern: 'random'; value: string };

/**
 * Read a reference back apart, when it has parts to read.
 *
 * **Never throws.** It used to, on anything that did not match — which was
 * defensible while every reference was structured, and is not now: a random
 * reference is perfectly valid and completely unparseable, and those two facts
 * are no longer in tension. There is also no way to tell a random reference
 * from a corrupt one, since both are just characters, so throwing would mean
 * raising on input we ourselves generated.
 *
 * What it gives you is a hint, not a source of truth. The row in the database
 * is authoritative about who owns a transaction and when it was made; this only
 * saves a lookup when someone is reading a log line or triaging a callback.
 */
export const extractSystemReference = (
  systemReference: string,
): SystemReferenceParts => {
  const match = systemReference.match(STRUCTURED_PATTERN);
  if (!match) return { pattern: 'random', value: systemReference };

  const [, nowMs, transactionType, paymentMethodName, providerName, userId] =
    match;

  const parsedUserId = Number(userId);
  const parsedDate = new Date(Number(nowMs));

  // The pattern matched but the values do not make sense — treat it as opaque
  // rather than returning a DTO built from a nonsense date.
  if (!Number.isInteger(parsedUserId) || Number.isNaN(parsedDate.getTime())) {
    return { pattern: 'random', value: systemReference };
  }

  return {
    pattern: 'structured',
    userId: parsedUserId,
    transactionType: transactionTypeConvert(transactionType),
    paymentMethodName: paymentMethodConvert(paymentMethodName),
    providerName: providerNameConvert(providerName),
    createdAt: parsedDate,
  };
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

/**
 * Keys under which raw provider payloads are stored in `metadata`.
 *
 * The column is one JSON object keyed by event rather than a single payload, so
 * each stage of a transaction's life keeps its own evidence instead of
 * overwriting the last. A disputed payment is argued from the create response
 * *and* the callback, and the callback arriving must never erase what we sent
 * to make the QR.
 */
export const TransactionMetadataKey = {
  CREATE_QRIS: 'CREATE_QRIS',
  CREATE_QRIS_ERROR: 'CREATE_QRIS_ERROR',
  CALLBACK_QRIS: 'CALLBACK_QRIS',
  STATUS_QRIS: 'STATUS_QRIS',
} as const;
export type TransactionMetadataKey =
  (typeof TransactionMetadataKey)[keyof typeof TransactionMetadataKey];
