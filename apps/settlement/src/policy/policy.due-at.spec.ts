import { SettlementModeEnum } from '@app/microservice';
import { describe, expect, it } from '@jest/globals';
import { DateTime } from 'luxon';
import {
  INSTANT_SLOT_MINUTES,
  mostRecentDueAt,
  settlementCutoff,
} from './policy.due-at';
import { isEligible } from './policy.eligibility';
import type { EligibilityPolicy, EligibilityWindow } from './policy.type';

const jkt = (iso: string): Date =>
  DateTime.fromISO(iso, { zone: 'Asia/Jakarta' }).toJSDate();

const policy = (over: Partial<EligibilityPolicy>): EligibilityPolicy => ({
  mode: SettlementModeEnum.INSTANT,
  delayDays: null,
  releaseTimes: [],
  businessDaysOnly: false,
  ...over,
});

const FOUR_BATCHES = policy({
  mode: SettlementModeEnum.SCHEDULED,
  releaseTimes: ['06:00', '12:00', '18:00', '23:00'],
});

const QRIS_WINDOW: EligibilityWindow = {
  settlementOffset: 1,
  settlementTime: '15:00',
  timezone: 'Asia/Jakarta',
};

/** MotionPay E-Wallet: H+3, no published time, so it releases at end of day. */
const EWALLET_WINDOW: EligibilityWindow = {
  settlementOffset: 3,
  settlementTime: null,
  timezone: 'Asia/Jakarta',
};

describe('mostRecentDueAt', () => {
  describe('SCHEDULED picks the latest boundary that has passed', () => {
    it.each([
      [
        'before the first batch, reaches back to yesterday',
        '05:30',
        '2026-10-14T23:00',
      ],
      ['exactly on a batch', '06:00', '2026-10-15T06:00'],
      ['between batches', '15:07', '2026-10-15T12:00'],
      ['after the last batch', '23:59', '2026-10-15T23:00'],
    ])('%s', (_label, nowTime, expected) => {
      const now = jkt(`2026-10-15T${nowTime}`);

      expect(mostRecentDueAt(FOUR_BATCHES, now)).toEqual(jkt(expected));
    });
  });

  /**
   * The point of the whole function: `@@unique([merchantId, paymentMethodName,
   * dueAt])` only collapses repeat enqueuer ticks if the value does not move
   * between them. A `new Date()` here would insert a fresh run every tick.
   */
  it('returns the same value for every instant within one boundary', () => {
    const seen = new Set(
      ['12:00', '12:00:01', '13:30', '17:59:59.999'].map((t) =>
        mostRecentDueAt(FOUR_BATCHES, jkt(`2026-10-15T${t}`))?.toISOString(),
      ),
    );

    expect(seen.size).toBe(1);
    expect([...seen][0]).toBe(jkt('2026-10-15T12:00').toISOString());
  });

  it('moves to the next boundary the instant it passes', () => {
    const before = mostRecentDueAt(
      FOUR_BATCHES,
      jkt('2026-10-15T17:59:59.999'),
    );
    const after = mostRecentDueAt(FOUR_BATCHES, jkt('2026-10-15T18:00'));

    expect(before).toEqual(jkt('2026-10-15T12:00'));
    expect(after).toEqual(jkt('2026-10-15T18:00'));
  });

  /**
   * `delayDays` shifts which payments are ripe, never when we look - so a
   * FIXED_DELAY boundary is daily at its release time whatever the delay.
   */
  it.each([[0], [1], [2], [7]])(
    'FIXED_DELAY with delayDays %i is still due daily at the release time',
    (delayDays) => {
      const given = policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays,
        releaseTimes: ['10:00'],
      });

      expect(mostRecentDueAt(given, jkt('2026-10-15T15:00'))).toEqual(
        jkt('2026-10-15T10:00'),
      );
    },
  );

  it('FIXED_DELAY before the release time reaches back to yesterday', () => {
    const given = policy({
      mode: SettlementModeEnum.FIXED_DELAY,
      delayDays: 1,
      releaseTimes: ['10:00'],
    });

    expect(mostRecentDueAt(given, jkt('2026-10-15T09:59'))).toEqual(
      jkt('2026-10-14T10:00'),
    );
  });

  describe('FOLLOW_UPSTREAM', () => {
    const follow = policy({ mode: SettlementModeEnum.FOLLOW_UPSTREAM });

    it('uses the window time, not the merchant policy', () => {
      expect(
        mostRecentDueAt(follow, jkt('2026-10-15T16:00'), QRIS_WINDOW),
      ).toEqual(jkt('2026-10-15T15:00'));
    });

    /**
     * An unpublished settlement time releases at endOf('day'). Writing that as
     * '23:59' would put the boundary 59.999 seconds early, and a cutoff built
     * from it would claim payments whose release moment has not passed.
     */
    it('treats a null settlementTime as the very end of the day', () => {
      expect(
        mostRecentDueAt(follow, jkt('2026-10-15T23:59:59.999'), EWALLET_WINDOW),
      ).toEqual(jkt('2026-10-15T23:59:59.999'));

      // One millisecond earlier, the day's boundary has not arrived yet.
      expect(
        mostRecentDueAt(follow, jkt('2026-10-15T23:59:59.998'), EWALLET_WINDOW),
      ).toEqual(jkt('2026-10-14T23:59:59.999'));
    });

    it('returns null with no window, so the enqueuer can skip quietly', () => {
      expect(mostRecentDueAt(follow, jkt('2026-10-15T16:00'))).toBeNull();
    });
  });

  describe('INSTANT', () => {
    const instant = policy({ mode: SettlementModeEnum.INSTANT });

    it('truncates into fixed slots so both pods agree', () => {
      expect(mostRecentDueAt(instant, jkt('2026-10-15T15:07:42.123'))).toEqual(
        jkt('2026-10-15T15:00'),
      );
      expect(mostRecentDueAt(instant, jkt('2026-10-15T15:19:59.999'))).toEqual(
        jkt('2026-10-15T15:10'),
      );
    });

    it('produces one value per slot across an hour', () => {
      const slots = new Set<string>();

      for (let minute = 0; minute < 60; minute += 1) {
        const now = jkt(`2026-10-15T15:${String(minute).padStart(2, '0')}:30`);
        slots.add(mostRecentDueAt(instant, now)!.toISOString());
      }

      expect(slots.size).toBe(60 / INSTANT_SLOT_MINUTES);
    });
  });

  it('refuses a businessDaysOnly policy rather than ignoring the flag', () => {
    expect(() =>
      mostRecentDueAt(
        policy({ ...FOUR_BATCHES, businessDaysOnly: true }),
        jkt('2026-10-15T15:00'),
      ),
    ).toThrow(/businessDaysOnly/);
  });

  it('returns null when a scheduled policy has no release times', () => {
    const given = policy({
      mode: SettlementModeEnum.SCHEDULED,
      releaseTimes: [],
    });

    expect(mostRecentDueAt(given, jkt('2026-10-15T15:00'))).toBeNull();
  });
});

/**
 * The invariant that matters more than any single case.
 *
 * The claim filters with `paidAt < cutoff`, one comparison for thousands of
 * rows, while `isEligible` is the rule of record for one payment. If the two
 * ever disagree in the generous direction, a merchant is paid before their
 * money has arrived from the upstream - unrecoverable, and nothing downstream
 * would catch it. So rather than asserting a handful of cutoffs, assert that
 * the two functions partition every payment identically.
 */
describe('settlementCutoff agrees with isEligible, payment by payment', () => {
  /** Every 30 minutes across four days, plus the awkward instants. */
  const payments = (): Date[] => {
    const out: Date[] = [];

    for (let day = 13; day <= 16; day += 1) {
      for (let hour = 0; hour < 24; hour += 1) {
        for (const minute of ['00', '30']) {
          out.push(
            jkt(`2026-10-${day}T${String(hour).padStart(2, '0')}:${minute}`),
          );
        }
      }
      out.push(jkt(`2026-10-${day}T23:59:59.999`));
      out.push(jkt(`2026-10-${day}T00:00:00.001`));
    }

    return out;
  };

  const nows = [
    '2026-10-16T00:00',
    '2026-10-16T05:30',
    '2026-10-16T06:00',
    '2026-10-16T09:59',
    '2026-10-16T10:00',
    '2026-10-16T12:00',
    '2026-10-16T15:00',
    '2026-10-16T15:07',
    '2026-10-16T18:00',
    '2026-10-16T23:00',
    // Inside the band between a '23:59' clock time and a true endOf('day'):
    // an unpublished settlement time releases at 23:59:59.999, and a boundary
    // written as '23:59' would be 59.999s early. Without a `now` in here the
    // partition test cannot see that difference.
    '2026-10-16T23:59:00',
    '2026-10-16T23:59:30',
    '2026-10-16T23:59:59.998',
    '2026-10-16T23:59:59.999',
  ];

  const cases: [string, EligibilityPolicy, EligibilityWindow | undefined][] = [
    ['INSTANT', policy({ mode: SettlementModeEnum.INSTANT }), undefined],
    ['SCHEDULED four batches', FOUR_BATCHES, undefined],
    [
      'SCHEDULED single daily cutoff',
      policy({ mode: SettlementModeEnum.SCHEDULED, releaseTimes: ['14:00'] }),
      undefined,
    ],
    [
      'FIXED_DELAY T+0',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: 0,
        releaseTimes: ['10:00'],
      }),
      undefined,
    ],
    [
      'FIXED_DELAY T+1',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: 1,
        releaseTimes: ['10:00'],
      }),
      undefined,
    ],
    [
      'FIXED_DELAY T+2',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: 2,
        releaseTimes: ['10:00'],
      }),
      undefined,
    ],
    [
      'FOLLOW_UPSTREAM QRIS T+1 15:00',
      policy({ mode: SettlementModeEnum.FOLLOW_UPSTREAM }),
      QRIS_WINDOW,
    ],
    [
      'FOLLOW_UPSTREAM e-wallet H+3 end of day',
      policy({ mode: SettlementModeEnum.FOLLOW_UPSTREAM }),
      EWALLET_WINDOW,
    ],
  ];

  describe.each(cases)('%s', (_label, given, window) => {
    it.each(nows)('partitions identically at %s', (nowIso) => {
      const now = jkt(nowIso);
      const cutoff = settlementCutoff(given, now, window);
      const disagreements: string[] = [];

      for (const paidAt of payments()) {
        const claimed = cutoff !== null && paidAt.getTime() < cutoff.getTime();
        const eligible = isEligible({ paidAt }, given, now, window);

        if (claimed !== eligible) {
          disagreements.push(
            `paidAt ${paidAt.toISOString()}: claim=${claimed} eligible=${eligible}`,
          );
        }
      }

      expect(disagreements).toEqual([]);
    });
  });

  /**
   * The direction that matters. A cutoff too *tight* only delays a merchant
   * until the next run; a cutoff too *generous* pays them before the upstream
   * has paid us, and the money is gone.
   */
  it('never claims a payment whose release moment is still in the future', () => {
    for (const [, given, window] of cases) {
      for (const nowIso of nows) {
        const now = jkt(nowIso);
        const cutoff = settlementCutoff(given, now, window);
        if (cutoff === null) continue;

        for (const paidAt of payments()) {
          if (paidAt.getTime() >= cutoff.getTime()) continue;

          expect(isEligible({ paidAt }, given, now, window)).toBe(true);
        }
      }
    }
  });
});

describe('settlementCutoff refusals', () => {
  const now = jkt('2026-10-15T15:00');

  it('returns null for FOLLOW_UPSTREAM with no window', () => {
    expect(
      settlementCutoff(
        policy({ mode: SettlementModeEnum.FOLLOW_UPSTREAM }),
        now,
      ),
    ).toBeNull();
  });

  it('returns null when a scheduled policy has no release times', () => {
    expect(
      settlementCutoff(
        policy({ mode: SettlementModeEnum.SCHEDULED, releaseTimes: [] }),
        now,
      ),
    ).toBeNull();
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
      'FIXED_DELAY with a negative delayDays',
      policy({
        mode: SettlementModeEnum.FIXED_DELAY,
        delayDays: -1,
        releaseTimes: ['10:00'],
      }),
      /cannot be negative/,
    ],
    [
      'a businessDaysOnly policy',
      policy({ ...FOUR_BATCHES, businessDaysOnly: true }),
      /businessDaysOnly/,
    ],
  ])('throws on %s', (_label, given, expected) => {
    expect(() => settlementCutoff(given, now)).toThrow(expected);
  });
});
