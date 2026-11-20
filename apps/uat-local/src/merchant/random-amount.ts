import { randomInt } from 'node:crypto';

/**
 * The highest last-two-digits that `scenarioFor` treats as the happy path.
 *
 * Transcribed from `provider/scenario.ts` rather than imported: the merchant
 * side is supposed to know nothing about the provider's switchboard, and a
 * merchant that imported the scenario table would be choosing its own
 * outcomes. Reading the number here and reading it there is the honest version
 * of a fake merchant that happens to send well-behaved amounts.
 */
export const SUCCESS_BAND_MAX = 69;

/** The amount to send, and whether the band had to be abandoned to get it. */
export interface BandedAmount {
  readonly amount: number;
  /**
   * True when `[min, max]` could not hold a banded value and `min` was used
   * instead. The caller warns in its own voice rather than this file guessing
   * which cron is talking.
   */
  readonly tooNarrow: boolean;
}

/**
 * A random amount, kept in the provider's happy band unless the switchboard is
 * on.
 *
 * Shared by both merchant crons because both pick an amount that the fake then
 * reads as an instruction, and the rule for staying inside the band is subtle
 * enough that two copies would drift. What differs between the two crons is
 * what the amount then *means* - a QRIS create versus a payout whose fee is
 * added on top - and that stays with each caller.
 *
 * `scenarioFor` keys on `amount % 100`, so an unconstrained random amount puts
 * roughly three in ten outside the `SUCCESS` band - some refused at create,
 * some held undelivered, and two in a hundred holding a connection open for
 * twenty seconds. That is Step 9's traffic, not Step 7's, so the same flag
 * governs both: switchboard off means well-behaved amounts and a quiet table,
 * switchboard on means the full range and the nine failure modes.
 *
 * The hundreds digit is drawn first and the last two added, rather than drawing
 * an amount and rewriting its tail - rewriting can push a value below `min`
 * when that bound does not end in `00`.
 */
export function bandedRandomAmount(
  min: number,
  max: number,
  switchboardEnabled: boolean,
): BandedAmount {
  if (switchboardEnabled) {
    return {
      amount: min >= max ? min : randomInt(min, max + 1),
      tooNarrow: false,
    };
  }

  const lowHundred = Math.ceil(min / 100);
  const highHundred = Math.floor((max - SUCCESS_BAND_MAX) / 100);

  // Nothing in [min, max] can both sit on a hundred and leave room for the
  // band - a range narrower than ~170 rupiah. Falling back to the bounds is
  // better than throwing, and the scenario is then whatever it is.
  if (lowHundred > highHundred) {
    return { amount: min, tooNarrow: true };
  }

  return {
    amount:
      randomInt(lowHundred, highHundred + 1) * 100 +
      randomInt(0, SUCCESS_BAND_MAX + 1),
    tooNarrow: false,
  };
}
