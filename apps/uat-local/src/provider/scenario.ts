/**
 * What the fake provider does, selected by the amount.
 *
 * A harness that behaves randomly cannot be watched, because nothing you see
 * can be reproduced. One that always succeeds is worse, because the happy path
 * is the one case already known to work. So the **last two digits of the
 * amount choose the behaviour**: the fake merchant still randomises amounts, a
 * run is still varied, and every outcome is readable off the log line that
 * caused it. Any case is reproducible on demand by sending that amount.
 *
 * `as const` plus a derived union rather than a TS `enum`: these values cross a
 * network boundary and get compared as strings.
 */
export const SCENARIO = {
  SUCCESS: 'SUCCESS',
  FAILED_BY_CALLBACK: 'FAILED_BY_CALLBACK',
  REJECTED_AT_CREATE: 'REJECTED_AT_CREATE',
  EXPIRED: 'EXPIRED',
  DUPLICATE_CALLBACK: 'DUPLICATE_CALLBACK',
  OUT_OF_ORDER: 'OUT_OF_ORDER',
  NEVER_DELIVERS: 'NEVER_DELIVERS',
  UNKNOWN_REFERENCE: 'UNKNOWN_REFERENCE',
  CREATE_500: 'CREATE_500',
  CREATE_TIMEOUT: 'CREATE_TIMEOUT',
} as const;
export type Scenario = (typeof SCENARIO)[keyof typeof SCENARIO];

/**
 * Cumulative upper bounds on `amount % 100`, so the happy path stays the
 * common case and the interesting ones still turn up often enough to watch.
 *
 * 70% success is deliberate. A band list where every outcome is equally likely
 * reads as a broken provider rather than a realistic one, and the failures
 * stop being noticeable.
 */
const BANDS: readonly { readonly upTo: number; readonly scenario: Scenario }[] =
  [
    { upTo: 69, scenario: SCENARIO.SUCCESS },
    { upTo: 74, scenario: SCENARIO.FAILED_BY_CALLBACK },
    { upTo: 77, scenario: SCENARIO.REJECTED_AT_CREATE },
    { upTo: 81, scenario: SCENARIO.EXPIRED },
    { upTo: 85, scenario: SCENARIO.DUPLICATE_CALLBACK },
    { upTo: 89, scenario: SCENARIO.OUT_OF_ORDER },
    { upTo: 92, scenario: SCENARIO.NEVER_DELIVERS },
    { upTo: 95, scenario: SCENARIO.UNKNOWN_REFERENCE },
    { upTo: 97, scenario: SCENARIO.CREATE_500 },
    { upTo: 99, scenario: SCENARIO.CREATE_TIMEOUT },
  ];

/**
 * So `Rp 50.072` fails by callback, `Rp 50.084` delivers its callback twice,
 * and `Rp 50.091` never reports at all. An amount ending `00`-`69` succeeds,
 * which is what to send when exercising the happy path by hand.
 */
export function scenarioFor(amount: number): Scenario {
  const key = Math.trunc(Math.abs(amount)) % 100;
  return BANDS.find((band) => key <= band.upTo)?.scenario ?? SCENARIO.SUCCESS;
}
