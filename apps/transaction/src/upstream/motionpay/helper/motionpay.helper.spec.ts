import { describe, expect, it } from '@jest/globals';
import { TransactionStatusEnum } from '@app/microservice';
import { EWalletEnum } from '@app/microservice';
import {
  getMotionPayTimestampSkewHours,
  mapMotionPayBillerStatus,
  motionPayBillerPaymentReference,
  motionPayBillerSystemReference,
  motionPayEWalletProductCode,
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

describe('mapMotionPayBillerStatus', () => {
  it('maps 200 to SUCCESS', () => {
    expect(mapMotionPayBillerStatus(200)).toBe(TransactionStatusEnum.SUCCESS);
  });

  /**
   * `202 Pending` is the ordinary outcome of a top-up, not a problem - they
   * settle asynchronously. Mapping it to anything terminal would close out
   * transactions that are still in flight.
   */
  it('holds 202 as PENDING', () => {
    expect(mapMotionPayBillerStatus(202)).toBe(TransactionStatusEnum.PENDING);
  });

  it('maps documented rejections to FAILED', () => {
    for (const code of [400, 401, 402, 403, 404, 405, 503]) {
      expect(mapMotionPayBillerStatus(code)).toBe(TransactionStatusEnum.FAILED);
    }
  });

  /**
   * MotionPay's own documented rule for undefined codes: record as Pending and
   * let the next business day's reconciliation resolve it. Also the only safe
   * direction - never assert paid or failed on a state we do not understand.
   */
  it('holds anything undocumented as PENDING', () => {
    expect(mapMotionPayBillerStatus(299)).toBe(TransactionStatusEnum.PENDING);
    expect(mapMotionPayBillerStatus(500)).toBe(TransactionStatusEnum.PENDING);
    expect(mapMotionPayBillerStatus(undefined)).toBe(
      TransactionStatusEnum.PENDING,
    );
    expect(mapMotionPayBillerStatus(null)).toBe(TransactionStatusEnum.PENDING);
  });

  /** 204/205 are duplicates - the real state has to be fetched, not assumed. */
  it('holds duplicate-id rejections as PENDING, not FAILED', () => {
    expect(mapMotionPayBillerStatus(204)).toBe(TransactionStatusEnum.PENDING);
    expect(mapMotionPayBillerStatus(205)).toBe(TransactionStatusEnum.PENDING);
  });
});

describe('biller external_id derivation', () => {
  const SYSTEM_REFERENCE = '1772001455392DTEMTNPY-27-a1b2';

  /**
   * The biller spec requires the payment leg's `external_id` to differ from the
   * inquiry's. Deriving rather than storing a second reference is what keeps the
   * status endpoint - which is keyed by the payment id - reachable from the one
   * value the row holds.
   */
  it('derives a payment reference distinct from the inquiry one', () => {
    const payment = motionPayBillerPaymentReference(SYSTEM_REFERENCE);

    expect(payment).not.toBe(SYSTEM_REFERENCE);
    expect(payment.startsWith(SYSTEM_REFERENCE)).toBe(true);
  });

  it('round-trips back to the system reference', () => {
    expect(
      motionPayBillerSystemReference(
        motionPayBillerPaymentReference(SYSTEM_REFERENCE),
      ),
    ).toBe(SYSTEM_REFERENCE);
  });

  /**
   * The callback echoes the payment id, but a status poll or a manual replay
   * might pass the bare reference. Stripping has to be idempotent so both reach
   * the same row.
   */
  it('leaves an unsuffixed reference alone', () => {
    expect(motionPayBillerSystemReference(SYSTEM_REFERENCE)).toBe(
      SYSTEM_REFERENCE,
    );
  });

  /** Their `external_id` cap is 64; ours is 32, so the suffix always fits. */
  it('stays inside the provider limit', () => {
    expect(
      motionPayBillerPaymentReference(SYSTEM_REFERENCE).length,
    ).toBeLessThanOrEqual(64);
  });
});

describe('motionPayEWalletProductCode', () => {
  /**
   * Open-amount products only. Fixed-denomination PPOB codes would make the
   * product the price, which is a different business - we are a gateway using a
   * cheap rail, not a loket selling vouchers.
   */
  it('maps every wallet we accept to an open-amount product', () => {
    expect(motionPayEWalletProductCode(EWalletEnum.OVO)).toBe('ESBO01');
    expect(motionPayEWalletProductCode(EWalletEnum.DANA)).toBe('ESBO02');
    expect(motionPayEWalletProductCode(EWalletEnum.GOPAY)).toBe('ESBO03');
    expect(motionPayEWalletProductCode(EWalletEnum.SHOPEEPAY)).toBe('ESBO04');
  });

  it('covers the whole enum, so a new wallet cannot be silently unroutable', () => {
    for (const wallet of Object.values(EWalletEnum)) {
      expect(motionPayEWalletProductCode(wallet)).toMatch(/^ESBO\d{2}$/);
    }
  });
});
