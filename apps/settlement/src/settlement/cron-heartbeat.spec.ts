import { describe, expect, it } from '@jest/globals';
import { CronHeartbeat } from './cron-heartbeat';

/**
 * The silence budget is 30 minutes, so a job's announce interval is
 * ceil(30 / its tick interval). Verified rather than restated, because the
 * whole point is that three jobs on three different schedules go quiet for
 * about the same wall-clock time.
 */
describe('CronHeartbeat', () => {
  /** Returns the tick numbers (1-based) on which it chose to announce. */
  const announcementsOver = (
    intervalMinutes: number,
    ticks: number,
  ): number[] => {
    const heartbeat = new CronHeartbeat(intervalMinutes);
    const spoke: number[] = [];

    for (let tick = 1; tick <= ticks; tick += 1) {
      if (heartbeat.wasIdle() !== null) spoke.push(tick);
    }

    return spoke;
  };

  it.each([
    ['the runner, every 2 minutes', 2, 15],
    ['the sweeper, every 5 minutes', 5, 6],
    ['the enqueuer, every 10 minutes', 10, 3],
  ])('%s announces every %i ticks', (_label, intervalMinutes, expected) => {
    const [first] = announcementsOver(intervalMinutes, expected * 2);

    expect(first).toBe(expected);
  });

  it.each([
    ['the runner', 2],
    ['the sweeper', 5],
    ['the enqueuer', 10],
  ])('%s stays silent for about 30 minutes at a time', (_label, interval) => {
    const [first] = announcementsOver(interval, 100);
    const silenceMinutes = first * interval;

    // Ceiling division can overshoot by less than one interval, never under.
    expect(silenceMinutes).toBeGreaterThanOrEqual(30);
    expect(silenceMinutes).toBeLessThan(30 + interval);
  });

  it('announces at a steady cadence, not just once', () => {
    expect(announcementsOver(10, 12)).toEqual([3, 6, 9, 12]);
  });

  it('reports the running idle count, which is what an operator reads', () => {
    const heartbeat = new CronHeartbeat(10);

    expect(heartbeat.wasIdle()).toBeNull();
    expect(heartbeat.wasIdle()).toBeNull();
    expect(heartbeat.wasIdle()).toBe(3);
    expect(heartbeat.wasIdle()).toBeNull();
    expect(heartbeat.wasIdle()).toBeNull();
    expect(heartbeat.wasIdle()).toBe(6);
  });

  /**
   * A tick that logged real output has already proved the job is alive, so the
   * streak starts over - otherwise a busy job would still emit "alive, nothing
   * due" on some later tick purely because of ticks before the work.
   */
  it('resets the streak when a tick does work', () => {
    const heartbeat = new CronHeartbeat(10);

    heartbeat.wasIdle();
    heartbeat.wasIdle();
    heartbeat.didWork();

    expect(heartbeat.wasIdle()).toBeNull();
    expect(heartbeat.wasIdle()).toBeNull();
    expect(heartbeat.wasIdle()).toBe(3);
  });

  /**
   * A job firing less often than the whole silence budget has nothing to batch
   * up, so it should speak on every idle tick rather than divide to zero.
   */
  it.each([[30], [60], [1440]])(
    'announces every idle tick when the interval is %i minutes',
    (interval) => {
      expect(announcementsOver(interval, 4)).toEqual([1, 2, 3, 4]);
    },
  );
});
