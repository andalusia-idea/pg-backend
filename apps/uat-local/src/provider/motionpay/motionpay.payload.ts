import { FakeTransaction, OUTCOME, Outcome } from '../provider.store';
import { motionPayTimestamp } from './motionpay.fake.helper';

/**
 * How far in the past an expired QR claims to have expired.
 *
 * Any positive value works - `isExpiry` only asks whether the expiry is at or
 * before now - but a minute reads as a QR that lapsed rather than one that
 * expired in the same instant it was reported, which would look like a clock
 * problem.
 */
const EXPIRED_AGO_MS = 60_000;

/**
 * MotionPay's QRIS callback, in their vocabulary.
 *
 * Hand-written against the provider's spec rather than built from
 * `MotionPayQrisCallbackSchema`, for the same reason the create payloads are:
 * a fake that shares our parser cannot catch a wrong parser. If this drifts
 * from what the real controller accepts, the drift is the finding.
 *
 * **Timestamps print a real `+07:00`, not the sketch's bare wall clock.**
 * §6.5 of the design doc emits `YYYY-MM-DD HH:mm:ss` with no offset. The
 * regex in `motionpay.helper.ts` accepts that, and under
 * `DEFAULT_TIMESTAMP_MODE = 'offset'` an absent offset means *the wall clock is
 * already UTC* - so a Jakarta wall clock with no offset is read seven hours
 * late. Every `paidAt` would land in the future and
 * `getMotionPayTimestampSkewHours` would log an error on every callback. See
 * `motionPayTimestamp` for the longer version of this argument.
 */
export function motionPayQrisCallback(
  row: FakeTransaction,
  outcome: Outcome,
  providerReference: string,
): Record<string, unknown> {
  const now = new Date();

  const base = {
    transaction_id: providerReference,
    external_id: row.systemReference,
    amount: row.amount,
    qris_type: 'QRIS_DYNAMIC',
    created_at: motionPayTimestamp(new Date(row.createdAt)),
    updated_at: motionPayTimestamp(now),
    rrn: `UAT${Date.now()}`,
    acquirer_name: 'UAT ACQUIRER',
  };

  /**
   * **The provider has no EXPIRED status.** An expiry is a `FAILED` whose
   * description says so, *and* whose structure agrees: the expiry has passed
   * and nothing was paid. `isExpiry` requires all three together, so a fake
   * setting only one of them would pass through as a plain `FAILED` and prove
   * nothing about the derivation.
   */
  if (outcome === OUTCOME.EXPIRED) {
    return {
      ...base,
      status: 'FAILED',
      description: 'Order expired',
      expired_date: motionPayTimestamp(
        new Date(now.getTime() - EXPIRED_AGO_MS),
      ),
    };
  }

  const success = outcome === OUTCOME.SUCCESS;

  return {
    ...base,
    status: success ? 'SUCCESS' : 'FAILED',

    /**
     * The scenario name travels in the description, so a surprising row in the
     * transaction log can be traced back to what produced it.
     *
     * Safe despite `isExpiry` sniffing this field for the word "expire": the
     * only scenario whose name contains it delivers `OUTCOME.EXPIRED`, which
     * returned above - and this branch never sets `expired_date`, so
     * `pastExpiry` is false and the check cannot fire on a description alone.
     */
    description: success ? 'Payment Received' : `UAT ${row.scenario}`,

    /**
     * Omitted rather than nulled when nothing was paid. `paid_date` is read
     * straight into `paidAt`, and a payment time on a transaction nobody paid
     * is exactly what makes a balance wrong.
     */
    ...(success ? { paid_date: motionPayTimestamp(now) } : {}),
  };
}
