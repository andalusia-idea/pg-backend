import { TransactionStatusEnum } from '@app/microservice';
import { MOTIONPAY_TRANSACTION_STATUS } from './motionpay.constant';

/** WIB is UTC+7, with no daylight saving. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Matches the datetime components, capturing any trailing offset separately.
 *
 * Both shapes MotionPay emits are accepted: `2026-09-02T09:16:26+00:00` and the
 * space-separated `2023-12-06 18:12:19` seen in older samples.
 */
const MOTIONPAY_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * How to read the offset MotionPay attaches to its timestamps.
 *
 * - `offset` - trust it, i.e. parse as ordinary ISO-8601. **This is what the
 *   sandbox actually does**, measured against our own clock.
 * - `wib` - discard the stated offset and read the wall clock as WIB (UTC+7).
 *   This is what the v2.7 spec *says* happens.
 *
 * The two disagree by seven hours, which is why this is a setting rather than a
 * decision baked into the parser.
 */
export type MotionPayTimestampMode = 'offset' | 'wib';

export const DEFAULT_TIMESTAMP_MODE: MotionPayTimestampMode = 'offset';

/**
 * Parse a MotionPay timestamp into a real instant.
 *
 * **The documentation and the API disagree about what these mean. Read this
 * before changing anything here.**
 *
 * QRIS Service v2.7, §Important Notes, states:
 *
 * > All timestamps ... are in WIB (UTC+7). Although the timestamp string
 * > displays a `+00:00` offset, the time values are native WIB and do not
 * > require any conversion.
 *
 * That is **not** what the sandbox does. Measured on 2026-09-02 by creating
 * transactions and comparing `created_date` against our own clock at the moment
 * of the request:
 *
 * ```
 * created_date=2026-09-02T09:16:26+00:00  ourUTC=2026-09-02T09:16:25.966Z
 *    skew if offset trusted: 0s   |   skew if treated as WIB: -7.0h
 * ```
 *
 * Three consecutive creates, sub-second every time. The offset is truthful and
 * the spec's note is wrong - at least for sandbox.
 *
 * The default therefore trusts the offset, because that is the behaviour we can
 * observe. The `wib` mode is kept rather than deleted because production may
 * yet match the documentation, and a seven-hour error in `paid_date` corrupts
 * settlement windows and reconciliation *silently* - every value still looks
 * like a plausible timestamp.
 *
 * {@link getMotionPayTimestampSkewHours} exists so the assumption is checked
 * continuously instead of trusted forever.
 *
 * Returns `null` for an empty string - how this provider says "not applicable"
 * (`paid_date` on an unpaid transaction) - and for anything unparseable, so a
 * format change surfaces as a missing value rather than a confidently wrong one.
 */
export function parseMotionPayTimestamp(
  value?: string | null,
  mode: MotionPayTimestampMode = DEFAULT_TIMESTAMP_MODE,
): Date | null {
  if (!value) return null;

  const match = MOTIONPAY_TIMESTAMP.exec(value.trim());
  if (!match) return null;

  const [, year, month, day, hour, minute, second, offset] = match;
  const wallClockAsUtcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (Number.isNaN(wallClockAsUtcMs)) return null;

  // The wall clock is Jakarta time; whatever offset was printed is noise.
  if (mode === 'wib') return new Date(wallClockAsUtcMs - WIB_OFFSET_MS);

  // Trust the offset. With none printed, the wall clock is already UTC.
  return new Date(wallClockAsUtcMs - (offset ? parseOffsetMs(offset) : 0));
}

function parseOffsetMs(offset: string): number {
  if (offset === 'Z') return 0;

  const sign = offset.startsWith('-') ? -1 : 1;
  const digits = offset.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));

  return sign * (hours * 60 + minutes) * 60 * 1000;
}

/**
 * How far a provider timestamp sits from a moment we already know.
 *
 * Used on the create response, where `created_date` describes a transaction we
 * made *just now* - so our own clock is ground truth and the check costs
 * nothing. If MotionPay ever changes to match their documentation, the skew
 * jumps to seven hours and we learn it from a log line the same day, rather
 * than from a reconciliation that will not balance weeks later.
 *
 * Returns `null` when the value cannot be parsed at all.
 */
export function getMotionPayTimestampSkewHours(
  value: string | null | undefined,
  reference: Date = new Date(),
  mode: MotionPayTimestampMode = DEFAULT_TIMESTAMP_MODE,
): number | null {
  const parsed = parseMotionPayTimestamp(value, mode);
  if (!parsed) return null;

  return (parsed.getTime() - reference.getTime()) / 3_600_000;
}

/**
 * What MotionPay's `status` plus its timestamps actually mean for us.
 *
 * MotionPay has **no EXPIRED status**. An expired QR arrives as `FAILED` with
 * `description: "Order expired"`, which is the only thing distinguishing it
 * from a genuine payment failure.
 *
 * Matching on that description alone would be fragile - it is prose, and prose
 * gets reworded. So expiry is confirmed structurally as well: the QR's expiry
 * instant has passed and no payment was ever recorded. Either signal alone is
 * weak; together they are strong enough to act on.
 *
 * Anything unrecognised holds as PENDING, per MotionPay's own documented rule
 * for undefined response codes and the only safe direction for a payment
 * system - never assert paid or failed on a state we do not understand.
 */
export function mapMotionPayStatus(input: {
  status: string;
  description?: string | null;
  expiredDate?: string | null;
  paidDate?: string | null;
  now?: Date;
  mode?: MotionPayTimestampMode;
}): TransactionStatusEnum {
  const status = input.status.toUpperCase();

  if (status === MOTIONPAY_TRANSACTION_STATUS.SUCCESS) {
    return TransactionStatusEnum.SUCCESS;
  }

  if (status === MOTIONPAY_TRANSACTION_STATUS.FAILED) {
    return isExpiry(input)
      ? TransactionStatusEnum.EXPIRED
      : TransactionStatusEnum.FAILED;
  }

  return TransactionStatusEnum.PENDING;
}

/**
 * A FAILED that is really an expiry.
 *
 * Requires the description to say so **and** the structure to agree: expiry
 * passed, nothing paid. A payment that failed for any other reason still has an
 * `expired_date` in the future or a `paid_date` present, so it will not be
 * misread as expired.
 */
function isExpiry(input: {
  description?: string | null;
  expiredDate?: string | null;
  paidDate?: string | null;
  now?: Date;
  mode?: MotionPayTimestampMode;
}): boolean {
  const saysExpired = (input.description ?? '')
    .toLowerCase()
    .includes('expire');

  const paidAt = parseMotionPayTimestamp(input.paidDate, input.mode);
  if (paidAt) return false; // paid, so whatever else happened it did not expire

  const expiresAt = parseMotionPayTimestamp(input.expiredDate, input.mode);
  const now = input.now ?? new Date();
  const pastExpiry = expiresAt !== null && expiresAt.getTime() <= now.getTime();

  return saysExpired && pastExpiry;
}

/**
 * Keys under which raw provider payloads are stored in `metadata`.
 *
 * The column is one JSON object keyed by event rather than a single payload, so
 * each stage of a transaction's life keeps its own evidence instead of
 * overwriting the last. A disputed payment is argued from the create response
 * *and* the callback, and the callback arriving must never erase what we sent
 * to make the QR.
 */
export const MOTIONPAY_METADATA_KEY = {
  CREATE_QRIS: 'CREATE_QRIS',
  /** Why a create attempt failed, kept so a FAILED row explains itself. */
  CREATE_QRIS_ERROR: 'CREATE_QRIS_ERROR',
  CALLBACK_QRIS: 'CALLBACK_QRIS',
  STATUS_QRIS: 'STATUS_QRIS',
} as const;
export type MotionPayMetadataKey =
  (typeof MOTIONPAY_METADATA_KEY)[keyof typeof MOTIONPAY_METADATA_KEY];
