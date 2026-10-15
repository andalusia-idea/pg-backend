import { SettlementModeEnum } from '@app/microservice';
import { describe, expect, it } from '@jest/globals';
import { DateTime } from 'luxon';
import { isEligible, settlementReleaseAt } from './policy.eligibility';
import type { EligibilityPolicy, EligibilityWindow } from './policy.type';

/**
 * Every instant in here is built in `Asia/Jakarta` explicitly, never from a bare
 * `new Date('...')`. The whole point of the module is that the answer does not
 * depend on where the process runs, so a spec that leaned on the machine's local
 * zone would pass on a laptop in Jakarta and fail in CI.
 */
const jkt = (iso: string): Date =>
  DateTime.fromISO(iso, { zone: 'Asia/Jakarta' }).toJSDate();

const inZone = (iso: string, zone: string): Date =>
  DateTime.fromISO(iso, { zone }).toJSDate();

const MINUTE = 60_000;

const policy = (over: Partial<EligibilityPolicy>): EligibilityPolicy => ({
  mode: SettlementModeEnum.INSTANT,
  delayDays: null,
  releaseTimes: [],
  businessDaysOnly: false,
  ...over,
});

/** MotionPay QRIS, per docs/accounting/upstream-settlement-schedules.md. */
const QRIS_WINDOW: EligibilityWindow = {
  settlementOffset: 1,
  settlementTime: '15:00',
  timezone: 'Asia/Jakarta',
};

/** MotionPay E-Wallet: H+3, no published time of day. */
const EWALLET_WINDOW: EligibilityWindow = {
  settlementOffset: 3,
  settlementTime: null,
  timezone: 'Asia/Jakarta',
};

describe('settlementReleaseAt', () => {
  describe.each([
    // mode, policy, paidAt, expected release
    [
      'INSTANT releases at the payment itself',
      policy({ mode: SettlementModeEnum.INSTANT }),
      '2026-10-14T13:37',
      '2026-10-14T13:37',
    ],
    [
      'FIXED_DELAY T+1 releases the next day at the release time',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: 1,
        releaseTimes: ['10:00'],
      }),
      '2026-10-14T09:00',
      '2026-10-15T10:00',
    ],
    [
      'FIXED_DELAY counts calendar days, so 23:59 lands with the rest of its day',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: 1,
        releaseTimes: ['10:00'],
      }),
      '2026-10-14T23:59',
      '2026-10-15T10:00',
    ],
    [
      'FIXED_DELAY 00:01 releases with the same batch as 23:59 the same day',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: 1,
        releaseTimes: ['10:00'],
      }),
      '2026-10-14T00:01',
      '2026-10-15T10:00',
    ],
    [
      'FIXED_DELAY T+2 releases two days later',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: 2,
        releaseTimes: ['10:00'],
      }),
      '2026-10-14T09:00',
      '2026-10-16T10:00',
    ],
    [
      'SCHEDULED picks the first batch at or after the payment',
      policy({
        mode: SettlementModeEnum.SCHEDULED,
        releaseTimes: ['06:00', '12:00', '18:00', '23:00'],
      }),
      '2026-10-14T05:00',
      '2026-10-14T06:00',
    ],
    [
      'SCHEDULED includes a payment landing exactly on a batch time',
      policy({
        mode: SettlementModeEnum.SCHEDULED,
        releaseTimes: ['06:00', '12:00', '18:00', '23:00'],
      }),
      '2026-10-14T06:00',
      '2026-10-14T06:00',
    ],
    [
      'SCHEDULED moves to the next batch one minute later',
      policy({
        mode: SettlementModeEnum.SCHEDULED,
        releaseTimes: ['06:00', '12:00', '18:00', '23:00'],
      }),
      '2026-10-14T06:01',
      '2026-10-14T12:00',
    ],
    [
      'SCHEDULED rolls a 23:59 payment to the first batch tomorrow',
      policy({
        mode: SettlementModeEnum.SCHEDULED,
        releaseTimes: ['06:00', '12:00', '18:00', '23:00'],
      }),
      '2026-10-14T23:59',
      '2026-10-15T06:00',
    ],
    [
      'SCHEDULED does not depend on releaseTimes being stored in order',
      policy({
        mode: SettlementModeEnum.SCHEDULED,
        releaseTimes: ['23:00', '06:00', '18:00', '12:00'],
      }),
      '2026-10-14T05:00',
      '2026-10-14T06:00',
    ],
    [
      'SCHEDULED with a single batch behaves like a daily cutoff',
      policy({
        mode: SettlementModeEnum.SCHEDULED,
        releaseTimes: ['14:00'],
      }),
      '2026-10-14T14:01',
      '2026-10-15T14:00',
    ],
  ])('%s', (_label, given, paidAt, expected) => {
    it('resolves to the expected moment', () => {
      expect(settlementReleaseAt({ paidAt: jkt(paidAt) }, given)).toEqual(
        jkt(expected),
      );
    });
  });

  describe('FOLLOW_UPSTREAM', () => {
    const follow = policy({ mode: SettlementModeEnum.FOLLOW_UPSTREAM });

    it('uses the partner window: QRIS settles T+1 at 15:00', () => {
      expect(
        settlementReleaseAt(
          { paidAt: jkt('2026-10-14T09:00') },
          follow,
          QRIS_WINDOW,
        ),
      ).toEqual(jkt('2026-10-15T15:00'));
    });

    it('counts calendar days, so a 23:59 payment settles T+1 not T+2', () => {
      expect(
        settlementReleaseAt(
          { paidAt: jkt('2026-10-14T23:59') },
          follow,
          QRIS_WINDOW,
        ),
      ).toEqual(jkt('2026-10-15T15:00'));
    });

    /**
     * "H+3" with no hour attached. Releasing at 00:00 on H+3 would be us paying
     * the merchant before the upstream has paid us, so the assumption has to be
     * the latest the money could land, not the earliest.
     */
    it('assumes end of day when the partner publishes no time', () => {
      expect(
        settlementReleaseAt(
          { paidAt: jkt('2026-10-14T09:00') },
          follow,
          EWALLET_WINDOW,
        ),
      ).toEqual(jkt('2026-10-17T23:59:59.999'));
    });

    /**
     * The window carries its own timezone because a partner's published
     * schedule is in theirs. A payment at 2026-10-14T00:30 Jakarta is already
     * 01:30 on the 14th in Singapore, but a payment at 23:30 Jakarta is 00:30
     * on the *15th* there - so the settlement day differs.
     */
    it('does the day arithmetic in the window timezone, not Jakarta', () => {
      const sgWindow: EligibilityWindow = {
        settlementOffset: 1,
        settlementTime: '15:00',
        timezone: 'Asia/Singapore',
      };

      expect(
        settlementReleaseAt(
          { paidAt: jkt('2026-10-14T23:30') },
          follow,
          sgWindow,
        ),
      ).toEqual(inZone('2026-10-16T15:00', 'Asia/Singapore'));
    });

    it('settles same day when the offset is zero', () => {
      expect(
        settlementReleaseAt({ paidAt: jkt('2026-10-14T09:00') }, follow, {
          settlementOffset: 0,
          settlementTime: '19:00',
          timezone: 'Asia/Jakarta',
        }),
      ).toEqual(jkt('2026-10-14T19:00'));
    });
  });
});

describe('isEligible', () => {
  /**
   * The boundary in both directions, for every mode. An off-by-one here either
   * pays a merchant early or holds their money an extra batch, and neither
   * shows up in a test that only checks the happy middle.
   */
  describe.each([
    [
      'INSTANT',
      policy({ mode: SettlementModeEnum.INSTANT }),
      undefined,
      '2026-10-14T13:37',
      '2026-10-14T13:37',
    ],
    [
      'FIXED_DELAY',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: 1,
        releaseTimes: ['10:00'],
      }),
      undefined,
      '2026-10-14T09:00',
      '2026-10-15T10:00',
    ],
    [
      'SCHEDULED',
      policy({
        mode: SettlementModeEnum.SCHEDULED,
        releaseTimes: ['06:00', '12:00', '18:00', '23:00'],
      }),
      undefined,
      '2026-10-14T06:01',
      '2026-10-14T12:00',
    ],
    [
      'FOLLOW_UPSTREAM',
      policy({ mode: SettlementModeEnum.FOLLOW_UPSTREAM }),
      QRIS_WINDOW,
      '2026-10-14T09:00',
      '2026-10-15T15:00',
    ],
  ])('%s', (_mode, given, window, paidAt, release) => {
    const payment = { paidAt: jkt(paidAt) };
    const releaseAt = jkt(release);

    it('is not eligible one minute before release', () => {
      const justBefore = new Date(releaseAt.getTime() - MINUTE);

      expect(isEligible(payment, given, justBefore, window)).toBe(false);
    });

    it('is not eligible one millisecond before release', () => {
      const justBefore = new Date(releaseAt.getTime() - 1);

      expect(isEligible(payment, given, justBefore, window)).toBe(false);
    });

    it('is eligible exactly at release', () => {
      expect(isEligible(payment, given, releaseAt, window)).toBe(true);
    });

    it('is eligible one minute after release', () => {
      const justAfter = new Date(releaseAt.getTime() + MINUTE);

      expect(isEligible(payment, given, justAfter, window)).toBe(true);
    });
  });

  /**
   * T+0 at 10:00 for a payment at 23:59 means the release time already passed
   * on the day it was paid, so the funds are available immediately rather than
   * tomorrow. Worth pinning: the arithmetic produces a release moment *before*
   * the payment, which looks wrong until you say it out loud.
   */
  it('releases immediately when a same-day release time has already passed', () => {
    const paidAt = jkt('2026-10-14T23:59');
    const given = policy({
      mode: SettlementModeEnum.FIXED_DELAY,
      delayDays: 0,
      releaseTimes: ['10:00'],
    });

    expect(settlementReleaseAt({ paidAt }, given)).toEqual(
      jkt('2026-10-14T10:00'),
    );
    expect(isEligible({ paidAt }, given, paidAt)).toBe(true);
  });
});

describe('refusals', () => {
  const paidAt = jkt('2026-10-14T09:00');

  /**
   * The calendar is deliberately unbuilt until Pakailink is live. Treating the
   * flag as `false` would release funds on a holiday while the admin who ticked
   * it believes otherwise - so every mode refuses while it is set.
   */
  describe.each([
    [SettlementModeEnum.INSTANT],
    [SettlementModeEnum.FIXED_DELAY],
    [SettlementModeEnum.SCHEDULED],
    [SettlementModeEnum.FOLLOW_UPSTREAM],
  ])('businessDaysOnly on %s', (mode) => {
    it('throws rather than ignoring the flag', () => {
      expect(() =>
        settlementReleaseAt(
          { paidAt },
          policy({
            mode,
            businessDaysOnly: true,
            delayDays: 1,
            releaseTimes: ['10:00'],
          }),
          QRIS_WINDOW,
        ),
      ).toThrow(/businessDaysOnly/);
    });
  });

  it.each([
    [
      'FIXED_DELAY with no delayDays',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: null,
        releaseTimes: ['10:00'],
      }),
      /whole-number delayDays/,
    ],
    [
      'FIXED_DELAY with a fractional delayDays',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: 1.5,
        releaseTimes: ['10:00'],
      }),
      /whole-number delayDays/,
    ],
    [
      'FIXED_DELAY with a negative delayDays',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: -1,
        releaseTimes: ['10:00'],
      }),
      /cannot be negative/,
    ],
    [
      'FIXED_DELAY with no release time',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: 1,
        releaseTimes: [],
      }),
      /one entry in releaseTimes/,
    ],
    [
      'SCHEDULED with no release times',
      policy({ mode: SettlementModeEnum.SCHEDULED, releaseTimes: [] }),
      /at least one entry in releaseTimes/,
    ],
  ])('%s throws', (_label, given, expected) => {
    expect(() => settlementReleaseAt({ paidAt }, given)).toThrow(expected);
  });

  /**
   * A malformed time is a misconfigured policy, and the alternative to throwing
   * is silently treating "7:00" or "24:00" as some other hour and paying at the
   * wrong moment.
   */
  it.each([['7:00'], ['24:00'], ['12:60'], ['allday'], [''], ['10:00:00']])(
    'rejects the release time %p',
    (time) => {
      expect(() =>
        settlementReleaseAt(
          { paidAt },
          policy({
            mode: SettlementModeEnum.SCHEDULED,
            releaseTimes: [time],
          }),
        ),
      ).toThrow(/zero-padded HH:mm/);
    },
  );

  it('FOLLOW_UPSTREAM without a window throws rather than guessing', () => {
    expect(() =>
      settlementReleaseAt(
        { paidAt },
        policy({ mode: SettlementModeEnum.FOLLOW_UPSTREAM }),
      ),
    ).toThrow(/needs the UpstreamSettlementWindow/);
  });

  it('rejects a negative settlementOffset', () => {
    expect(() =>
      settlementReleaseAt(
        { paidAt },
        policy({ mode: SettlementModeEnum.FOLLOW_UPSTREAM }),
        { ...QRIS_WINDOW, settlementOffset: -1 },
      ),
    ).toThrow(/non-negative whole number/);
  });

  it('rejects an unknown timezone rather than silently falling back to UTC', () => {
    expect(() =>
      settlementReleaseAt(
        { paidAt },
        policy({ mode: SettlementModeEnum.FOLLOW_UPSTREAM }),
        { ...QRIS_WINDOW, timezone: 'Mars/Olympus_Mons' },
      ),
    ).toThrow(/Mars\/Olympus_Mons/);
  });
});
