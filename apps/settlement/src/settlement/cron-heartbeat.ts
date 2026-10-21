/**
 * How long a cron may stay silent before it says it is still alive.
 *
 * The problem this solves was found by running the three jobs on their real
 * schedules: the enqueuer, runner and sweeper all return early when there is
 * nothing to do, so a six-hour quiet spell looks exactly like a six-hour
 * outage. For jobs that move money on a schedule, "idle" and "dead" have to be
 * distinguishable without attaching a debugger.
 */
const HEARTBEAT_SILENCE_MINUTES = 30;

/**
 * Tracks consecutive idle ticks and decides when one is worth announcing.
 *
 * Shared by all three settlement crons rather than copied into each: it is six
 * lines of counter, and three copies of a counter is three places for the
 * cadence to drift apart.
 *
 * Deliberately not a Nest provider. It holds per-job mutable state, so each job
 * owns its own instance; registering it would mean one shared counter for three
 * jobs, which is the opposite of what it is for.
 */
export class CronHeartbeat {
  private idleTicks = 0;
  private readonly announceEvery: number;

  /**
   * @param intervalMinutes How often the job's cron fires, used to work out how
   *   many idle ticks fit in the silence budget. A 2-minute job announces every
   *   15 idle ticks, a 10-minute job every 3 - so all three jobs go quiet for
   *   about the same wall-clock time regardless of how often they run.
   */
  constructor(intervalMinutes: number) {
    this.announceEvery = Math.max(
      1,
      Math.ceil(HEARTBEAT_SILENCE_MINUTES / intervalMinutes),
    );
  }

  /**
   * Record a tick that did work. Resets the streak, because a job that just
   * logged real output has already proved it is alive.
   */
  didWork(): void {
    this.idleTicks = 0;
  }

  /**
   * Record a tick that found nothing.
   *
   * @returns the number of consecutive idle ticks when it is time to announce
   *   them, or `null` to stay quiet. Returning the count rather than a boolean
   *   lets the caller put it in the log line, which is the part an operator
   *   actually reads - "idle for 15 ticks" says both "alive" and "nothing has
   *   been due for half an hour".
   */
  wasIdle(): number | null {
    this.idleTicks += 1;

    if (this.idleTicks % this.announceEvery !== 0) return null;

    return this.idleTicks;
  }
}
