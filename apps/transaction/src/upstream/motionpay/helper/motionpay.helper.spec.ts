import { describe, expect, it } from '@jest/globals';
import { TransactionStatusEnum } from '@app/microservice';
import {
  getMotionPayTimestampSkewHours,
  mapMotionPayStatus,
  parseMotionPayTimestamp,
} from './motionpay.helper';

describe('parseMotionPayTimestamp', () => {
  /**
   * The default, and the behaviour actually measured against the sandbox on
   * 2026-09-02: `created_date` came back within a second of our own clock when
   * the offset was trusted, and exactly seven hours out when it was not.
   *
   * The v2.7 spec claims the opposite - that the values are WIB despite the
   * printed `+00:00`. It is wrong, at least for sandbox, which is why the
   * default trusts what the API does rather than what the document says.
   */
  it('trusts the printed offset by default', () => {
    expect(
      parseMotionPayTimestamp('2026-09-02T09:16:26+00:00')?.toISOString(),
    ).toBe('2026-09-02T09:16:26.000Z');
  });

  it('handles a non-zero offset', () => {
    expect(
      parseMotionPayTimestamp('2026-09-02T16:16:26+07:00')?.toISOString(),
    ).toBe('2026-09-02T09:16:26.000Z');
    expect(parseMotionPayTimestamp('2026-09-02T09:16:26Z')?.toISOString()).toBe(
      '2026-09-02T09:16:26.000Z',
    );
  });

  /**
   * Kept because production may yet behave the way the spec describes. The
   * seven-hour gap between the two readings is the whole reason this is a
   * setting and not a constant.
   */
  it('reads the wall clock as WIB in wib mode', () => {
    expect(
      parseMotionPayTimestamp(
        '2026-09-02T16:16:26+00:00',
        'wib',
      )?.toISOString(),
    ).toBe('2026-09-02T09:16:26.000Z');
  });

  it('the two modes differ by exactly seven hours', () => {
    const raw = '2026-09-02T09:16:26+00:00';
    const trusted = parseMotionPayTimestamp(raw, 'offset') as Date;
    const asWib = parseMotionPayTimestamp(raw, 'wib') as Date;

    expect((trusted.getTime() - asWib.getTime()) / 3_600_000).toBe(7);
  });

  /** Older samples use a space and no offset. Already UTC under the default. */
  it('accepts the space-separated form', () => {
    expect(parseMotionPayTimestamp('2023-12-06 18:12:19')?.toISOString()).toBe(
      '2023-12-06T18:12:19.000Z',
    );
  });

  /**
   * Empty string is how this provider says "not applicable" - `paid_date` on an
   * unpaid transaction. It must not become epoch zero.
   */
  it('treats an empty string as absent', () => {
    expect(parseMotionPayTimestamp('')).toBeNull();
    expect(parseMotionPayTimestamp(null)).toBeNull();
    expect(parseMotionPayTimestamp(undefined)).toBeNull();
  });

  it('returns null rather than a wrong date for an unparseable value', () => {
    expect(parseMotionPayTimestamp('not a date')).toBeNull();
    expect(parseMotionPayTimestamp('18/05/2026')).toBeNull();
  });
});

describe('getMotionPayTimestampSkewHours', () => {
  /**
   * The guard that keeps the mode honest. `created_date` describes a
   * transaction we just made, so our own clock is ground truth - a skew near
   * zero confirms the current mode, and a skew near seven says MotionPay
   * changed and the setting has to follow.
   */
  it('is ~0 when the mode matches the provider', () => {
    const now = new Date('2026-09-02T09:16:26.000Z');
    expect(
      getMotionPayTimestampSkewHours('2026-09-02T09:16:26+00:00', now),
    ).toBeCloseTo(0, 5);
  });

  it('is ~-7 when the provider switches to the documented WIB behaviour', () => {
    const now = new Date('2026-09-02T09:16:26.000Z');
    // Provider now means 09:16 WIB, i.e. 02:16Z, but still prints +00:00.
    expect(
      getMotionPayTimestampSkewHours('2026-09-02T09:16:26+00:00', now, 'wib'),
    ).toBeCloseTo(-7, 5);
  });

  it('returns null for an unusable value', () => {
    expect(getMotionPayTimestampSkewHours('')).toBeNull();
    expect(getMotionPayTimestampSkewHours('nope')).toBeNull();
  });
});

describe('mapMotionPayStatus', () => {
  const NOW = new Date('2026-05-18T10:00:00.000Z');

  it('maps SUCCESS', () => {
    expect(
      mapMotionPayStatus({
        status: 'SUCCESS',
        description: 'Payment Received',
      }),
    ).toBe(TransactionStatusEnum.SUCCESS);
  });

  /**
   * MotionPay has no EXPIRED status - an expired QR is FAILED with a prose
   * description. Both signals are required: the wording, and expiry actually
   * having passed with nothing paid.
   */
  it('maps an expired FAILED to EXPIRED when both signals agree', () => {
    expect(
      mapMotionPayStatus({
        status: 'FAILED',
        description: 'Order expired',
        expiredDate: '2026-05-18T09:00:00+00:00', // already past
        paidDate: '',
        now: NOW,
      }),
    ).toBe(TransactionStatusEnum.EXPIRED);
  });

  /** A genuine failure keeps FAILED, even though the word could be absent. */
  it('keeps a non-expiry FAILED as FAILED', () => {
    expect(
      mapMotionPayStatus({
        status: 'FAILED',
        description: 'Insufficient funds',
        expiredDate: '2026-05-18T09:00:00+00:00',
        paidDate: '',
        now: NOW,
      }),
    ).toBe(TransactionStatusEnum.FAILED);
  });

  /**
   * The structural half of the check. If the description says expired but the
   * QR has not actually expired yet, something is inconsistent - do not invent
   * an expiry.
   */
  it('does not report EXPIRED before the expiry instant has passed', () => {
    expect(
      mapMotionPayStatus({
        status: 'FAILED',
        description: 'Order expired',
        expiredDate: '2026-05-18T13:00:00+00:00', // still future
        paidDate: '',
        now: NOW,
      }),
    ).toBe(TransactionStatusEnum.FAILED);
  });

  /** A paid transaction cannot have expired, whatever the description says. */
  it('never reports EXPIRED when a payment was recorded', () => {
    expect(
      mapMotionPayStatus({
        status: 'FAILED',
        description: 'Order expired',
        expiredDate: '2026-05-18T09:00:00+00:00',
        paidDate: '2026-05-18T08:00:00+00:00',
        now: NOW,
      }),
    ).toBe(TransactionStatusEnum.FAILED);
  });

  it('holds an unrecognised status as PENDING', () => {
    expect(mapMotionPayStatus({ status: 'REVERSED' })).toBe(
      TransactionStatusEnum.PENDING,
    );
    expect(mapMotionPayStatus({ status: '' })).toBe(
      TransactionStatusEnum.PENDING,
    );
  });

  it('maps PENDING', () => {
    expect(mapMotionPayStatus({ status: 'PENDING' })).toBe(
      TransactionStatusEnum.PENDING,
    );
  });
});
