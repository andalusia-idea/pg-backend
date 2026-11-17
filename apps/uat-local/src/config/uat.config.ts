import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * The harness's own settings, in the shape `libs/configuration` uses.
 *
 * Lives here rather than in `libs/configuration` because nothing outside this
 * app has any business reading it - six apps share that library, and a UAT-only
 * config class in it would be visible to all of them.
 */
@Injectable()
export class UatConfig {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Where the fake provider posts its callbacks, and where the Step 7 merchant
   * crons send their signed requests.
   *
   * `localhost` is correct here even though the webhook URLs stored on the
   * merchant must be `127.0.0.1` - see build-order Step 2. Outbound, we are the
   * client, and `localhost` resolves to the same `::1` the other apps bind.
   */
  get TRANSACTION_BASE_URL(): string {
    return this.configService.getOrThrow<string>('TRANSACTION_BASE_URL');
  }

  /** Carries the `/api/v1` prefix; transaction sets none. */
  get DASHBOARD_BASE_URL(): string {
    return this.configService.getOrThrow<string>('DASHBOARD_BASE_URL');
  }

  /**
   * Whether the dispatcher delivers anything other than the `SUCCESS` band.
   *
   * Build-order Step 6 asks for one clean settlement before the other nine
   * scenarios are let loose, and Step 9 is titled *Turn the switchboard on*. A
   * flag makes that a one-line env change rather than a code edit, and keeps
   * the two steps independently re-runnable.
   *
   * `get`, not `getOrThrow`, and false unless the value is literally `true`:
   * the restrictive reading is the safe default, so a typo holds the harness at
   * Step 6 rather than quietly handing you ten scenarios at once.
   *
   * Note this gates **delivery**, not creation. `scenarioFor` still assigns
   * every band at create time, so a held transaction is visibly held - its row
   * sits in the store with its outcomes undelivered - rather than having
   * silently become a success.
   */
  get SWITCHBOARD_ENABLED(): boolean {
    const value = this.configService.get<string>('UAT_SWITCHBOARD_ENABLED');

    return (value ?? '').trim().toLowerCase() === 'true';
  }
}
