import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { UatConfig } from '../config';
import { MerchantCredentialsService } from './merchant-credentials.service';
import { signRequest } from './merchant-signer';
import { bandedRandomAmount } from './random-amount';

const ENDPOINT = '/v1/qr/qr-mpm-generate';

/** The cron fires every ten seconds, so six times a minute. */
const TICKS_PER_MINUTE = 6;

/**
 * Whole minutes, because the provider floors to them anyway - `expireSeconds`
 * takes 600-86,400 and 900 is honoured as exactly fifteen minutes. A value
 * that gets floored makes the `expiresAt` we log disagree with the one we
 * asked for, which looks like a bug in the harness.
 */
const EXPIRE_SECONDS = 900;

/** How long a create may take before we stop waiting on it. */
const POST_TIMEOUT_MS = 20_000;

let sequence = 0;

/**
 * Traffic without you - the purchase half.
 *
 * Signs with the merchant HMAC and calls the real merchant API, so every tick
 * exercises `MerchantEndpoint`, the signature guard, the nonce store and the
 * fee resolution before it ever reaches the fake provider. That is a second
 * surface a DI mock never touches, and the reason this is a cron inside the app
 * rather than a loop in a spec.
 *
 * ## Rate, and why there is an accumulator
 *
 * `@Cron` takes a fixed expression, so the tick is ten seconds and the rate is
 * how many purchases each tick sends. A fractional budget carried between ticks
 * is what makes a rate below six a minute work: at three a minute the budget
 * reaches 1.0 every second tick, so it fires every twenty seconds rather than
 * rounding down to nothing.
 *
 * ## Why it does not throw
 *
 * Every failure is logged and swallowed. A rejected promise inside a scheduled
 * task surfaces in the scheduler's voice rather than this one, and a cron that
 * dies on the first 409 stops being traffic.
 */
@Injectable()
export class PurchaseCron {
  private readonly logger = new Logger(PurchaseCron.name);

  /** Fractional purchases carried to the next tick. See the class comment. */
  private budget = 0;

  /** So "it is not running" is said once rather than every ten seconds. */
  private announcedIdle = false;

  constructor(
    private readonly http: HttpService,
    private readonly config: UatConfig,
    private readonly credentials: MerchantCredentialsService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'uat-merchant-purchases',
    waitForCompletion: true,
  })
  async tick(): Promise<void> {
    const perMinute = this.config.PURCHASE_PER_MINUTE;

    if (perMinute <= 0) {
      if (!this.announcedIdle) {
        this.announcedIdle = true;
        this.logger.log({
          msg: 'Purchase cron is idle: UAT_PURCHASE_PER_MINUTE is 0',
          hint: 'set it to 6 and restart to generate traffic (build-order Step 7)',
        });
      }
      return;
    }

    this.announcedIdle = false;

    this.budget += perMinute / TICKS_PER_MINUTE;
    const due = Math.floor(this.budget);
    if (due <= 0) return;
    this.budget -= due;

    // Read once per tick rather than once per purchase: a rotation between two
    // purchases ten milliseconds apart is not a case worth a second query.
    const credentials = await this.credentials.current();
    if (!credentials) return;

    for (let i = 0; i < due; i += 1) {
      await this.createOne(credentials.clientId, credentials.secretKey);
    }
  }

  private async createOne(clientId: string, secretKey: string): Promise<void> {
    const amount = this.randomAmount();
    const merchantReference = this.nextReference();

    const signed = signRequest({
      clientId,
      secretKey,
      method: 'POST',
      endpoint: ENDPOINT,
      payload: {
        amount: { value: String(amount), currency: 'IDR' },
        merchantReference,
        expireSeconds: EXPIRE_SECONDS,
      },
    });

    try {
      const response = await firstValueFrom(
        this.http.post(ENDPOINT, signed.body, {
          baseURL: this.config.TRANSACTION_BASE_URL,
          timeout: POST_TIMEOUT_MS,
          headers: signed.headers,
          // The signature covers these exact bytes, so axios must not
          // re-serialise them. Passing the string with an explicit
          // content-type is what stops it.
          transformRequest: [(data: unknown) => data],
          validateStatus: () => true,
        }),
      );

      const body = response.data as
        | { responseCode?: string; data?: { transactionId?: string } }
        | undefined;

      if (response.status >= 400) {
        // Expected often enough to be information rather than alarm: the
        // switchboard refuses an amount ending 75-77 at create, and 96-97
        // answers 500. Logged with the amount, because the amount is what
        // chose the outcome.
        this.logger.warn({
          msg: 'Purchase refused',
          merchantReference,
          amount,
          httpStatus: response.status,
          responseCode: body?.responseCode,
        });
        return;
      }

      this.logger.log({
        msg: 'Purchase created',
        merchantReference,
        amount,
        transactionId: body?.data?.transactionId,
        httpStatus: response.status,
      });
    } catch (error) {
      // A timeout or a refused connection. `CREATE_TIMEOUT` (amounts ending
      // 98-99) reaches here by design once the switchboard is on - the fake
      // holds the create past the client's own timeout, and the transaction
      // exists upstream even though we gave up on it.
      this.logger.error({
        msg: 'Purchase POST failed',
        merchantReference,
        amount,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * A random amount, kept in the provider's happy band while the switchboard
   * is off. The band rule itself lives in `random-amount.ts`, shared with the
   * payout cron.
   *
   * Why it matters here specifically: Sighting 7 is *"come back to a table of
   * settled transactions"*, and that table reads as a fault when a third of it
   * is stuck `PENDING` for reasons the step has not introduced yet.
   */
  private randomAmount(): number {
    const { amount, tooNarrow } = bandedRandomAmount(
      this.config.AMOUNT_MIN,
      this.config.AMOUNT_MAX,
      this.config.SWITCHBOARD_ENABLED,
    );

    if (tooNarrow) {
      this.logger.warn({
        msg: 'Amount range is too narrow to stay inside the SUCCESS band',
        min: this.config.AMOUNT_MIN,
        max: this.config.AMOUNT_MAX,
      });
    }

    return amount;
  }

  /**
   * Unique per merchant, which the API enforces with a 409.
   *
   * The counter is the same lesson `nextProviderReference` records: two creates
   * in one millisecond would otherwise send one reference twice, and the second
   * would be answered as a duplicate order rather than created.
   */
  private nextReference(): string {
    sequence += 1;
    return `UAT-P-${Date.now()}-${sequence.toString().padStart(4, '0')}`;
  }
}
