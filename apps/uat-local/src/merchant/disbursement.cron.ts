import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { UatConfig } from '../config';
import { MerchantCredentialsService } from './merchant-credentials.service';
import { signRequest } from './merchant-signer';
import { bandedRandomAmount } from './random-amount';

const ENDPOINT = '/v1/transfer/bank';

/** The cron fires every ten seconds, so six times a minute. */
const TICKS_PER_MINUTE = 6;

/**
 * The beneficiary every payout goes to.
 *
 * `014` is BCA and the account is the one inject step 07 and the Step 8 manual
 * payouts already used, so this rail is known to resolve. The name is left off
 * the request deliberately: `accountHolderName` is optional, the fake's
 * inquiry invents `UAT BENEFICIARY` whatever we send, and the real service
 * records *"the one the bank confirmed during inquiry - a merchant's own
 * spelling is not evidence of who owns the account"*. Sending nothing is the
 * version that exercises that rule.
 */
const BENEFICIARY = { bankCode: '014', accountNumber: '1234567890' } as const;

/** How long a create may take before we stop waiting on it. */
const POST_TIMEOUT_MS = 20_000;

let sequence = 0;

/**
 * Traffic without you - the payout half, and build-order Step 7's second cron.
 *
 * Signs with the merchant HMAC and calls the real merchant API, so every tick
 * exercises `MerchantEndpoint`, the signature guard, the nonce store, the
 * payout fee resolution and the balance reservation before it ever reaches the
 * Jatelindo fake. Same reasoning as `PurchaseCron`: a DI mock touches none of
 * that, which is why this is a cron inside the app rather than a loop in a
 * spec.
 *
 * ## Why this one arrived late
 *
 * It had to wait for Step 8c. Until `JATELINDO_TRANSFER_BASE_URL` pointed at
 * the local fake, a payout cron would have sent unattended transfer requests
 * to the provider's real dev host every few seconds.
 *
 * ## It needs a merchant with money, which is not the default state
 *
 * A payout reserves `netNominal` - the amount **plus** the fee - from the
 * merchant's `AVAILABLE` bucket, and a payin only credits `PENDING` until
 * settlement moves it. So a merchant whose purchases have not settled yet
 * cannot pay out at all, and every tick is refused for insufficient balance.
 *
 * That is why `UAT_DISBURSEMENT_PER_MINUTE` ships as `0`. Turn it on after a
 * settlement run has given the merchant an `AVAILABLE` balance, not before, or
 * the only thing the cron produces is one refusal every ten seconds.
 *
 * **There is deliberately no balance check here.** A real merchant discovers
 * it is out of money from the refusal, and that refusal path - reservation
 * declined, no transaction row, no balance movement - is worth exercising on
 * purpose. Querying the balance first would skip it and would also be a lie
 * about what a merchant can see.
 *
 * ## The amount still chooses the outcome, differently from QRIS
 *
 * The fake's `Transaction/SingleTransfer` runs the same `scenarioFor`
 * switchboard on `amount % 100`, so the bands are shared - but what they *mean*
 * is not. `EXPIRED` has no translation on a payout rail, so the fake reports it
 * as `E18 TIMEOUT`, which is SUSPECT and maps to `PENDING`: the callback
 * arrives, is accepted, and changes nothing. A payout that ends `78`-`81` is
 * therefore a transaction that stays `PENDING` for ever, and that is correct
 * rather than a fault.
 *
 * ## Why it does not throw
 *
 * Every failure is logged and swallowed, for the reason `PurchaseCron` gives:
 * a rejected promise inside a scheduled task surfaces in the scheduler's voice
 * rather than this one, and a cron that dies on the first refusal stops being
 * traffic.
 */
@Injectable()
export class DisbursementCron {
  private readonly logger = new Logger(DisbursementCron.name);

  /** Fractional payouts carried to the next tick. See `PurchaseCron`. */
  private budget = 0;

  /** So "it is not running" is said once rather than every ten seconds. */
  private announcedIdle = false;

  constructor(
    private readonly http: HttpService,
    private readonly config: UatConfig,
    private readonly credentials: MerchantCredentialsService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'uat-merchant-disbursements',
    waitForCompletion: true,
  })
  async tick(): Promise<void> {
    const perMinute = this.config.DISBURSEMENT_PER_MINUTE;

    if (perMinute <= 0) {
      if (!this.announcedIdle) {
        this.announcedIdle = true;
        this.logger.log({
          msg: 'Disbursement cron is idle: UAT_DISBURSEMENT_PER_MINUTE is 0',
          hint: 'set it to 3 and restart once the merchant has an AVAILABLE balance (build-order Step 7)',
        });
      }
      return;
    }

    this.announcedIdle = false;

    this.budget += perMinute / TICKS_PER_MINUTE;
    const due = Math.floor(this.budget);
    if (due <= 0) return;
    this.budget -= due;

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
        accountNumber: BENEFICIARY.accountNumber,
        bankCode: BENEFICIARY.bankCode,
        note: 'UAT payout cron',
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
        | {
            responseCode?: string;
            responseMessage?: string;
            data?: { transactionId?: string; status?: string };
          }
        | undefined;

      if (response.status >= 400) {
        // Expected often enough to be information rather than alarm. Two
        // different causes land here and the response code is what tells them
        // apart: an insufficient balance, which means settlement has not run
        // yet, and a scenario refusal, which the amount chose.
        this.logger.warn({
          msg: 'Payout refused',
          merchantReference,
          amount,
          httpStatus: response.status,
          responseCode: body?.responseCode,
          responseMessage: body?.responseMessage,
        });
        return;
      }

      // `PENDING` is the normal answer, not a half-success: a payout is
      // accepted here and resolved later by the provider's callback.
      this.logger.log({
        msg: 'Payout accepted',
        merchantReference,
        amount,
        transactionId: body?.data?.transactionId,
        status: body?.data?.status,
        httpStatus: response.status,
      });
    } catch (error) {
      // A timeout or a refused connection. `CREATE_TIMEOUT` (amounts ending
      // 98-99) reaches here by design once the switchboard is on - the fake
      // holds the transfer past the client's own timeout. On this rail that
      // matters more than on QRIS: the money may already have left, which is
      // exactly the case `outcomeUnknown` exists for, so the row is left
      // PENDING rather than failed.
      this.logger.error({
        msg: 'Payout POST failed',
        merchantReference,
        amount,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The amount to request, which is **not** the amount that leaves the
   * merchant's balance: the payout fee is added on top, so the reservation is
   * `netNominal` and always larger. Keeping the band on the requested amount
   * is what matters, because that is the value the provider sees and
   * `scenarioFor` reads.
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
   * Unique per merchant, which the API enforces with a 409 - and on this rail
   * that 409 is the retry guard: *"sending the same reference twice is
   * answered with a 409 rather than paying the recipient twice."*
   *
   * `UAT-D-` rather than `UAT-P-`, so a glance at the reference says which
   * cron made it. The counter is the same lesson the purchase cron records:
   * two creates in one millisecond would otherwise send one reference twice.
   */
  private nextReference(): string {
    sequence += 1;
    return `UAT-D-${Date.now()}-${sequence.toString().padStart(4, '0')}`;
  }
}
