import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { UatConfig } from '../config';
import {
  FakeTransaction,
  Outcome,
  PROVIDER,
  ProviderStore,
} from './provider.store';
import { SCENARIO } from './scenario';
import { motionPayQrisCallback } from './motionpay/motionpay.payload';

/**
 * Mirrors what both providers document: three attempts, then the callback is
 * dropped permanently.
 *
 * Their interval is five minutes. Seconds here, because the point is to watch
 * it happen rather than to wait out a real provider's patience - and because a
 * retry that outlives the harness session proves nothing.
 */
const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 15_000;

/** A resend is not instant, but it should not need a coffee break either. */
const RESEND_AFTER_MS = 5_000;

/**
 * Long enough to cover `settle()` doing real work - a fee TCP round trip, the
 * balance post, and the merchant notification - and short enough that a hung
 * callback does not stall the whole pass.
 */
const POST_TIMEOUT_MS = 10_000;

/**
 * The piece that makes the harness asynchronous.
 *
 * Everything before this step was request/response: a purchase came back with
 * a QR and sat `PENDING` forever. The dispatcher is what eventually tells
 * `apps/transaction` the money arrived, over the real callback route, through
 * the real IP allowlist, in the provider's real vocabulary.
 *
 * ## It is the delivery protocol, not just a POST
 *
 * The status code carries the whole contract, and the controller is built
 * around that: **500 means "transient, please retry"** and anything else is an
 * acknowledgement. So a 500 here is a protocol message rather than an error,
 * which is why `validateStatus` is defeated below instead of letting axios
 * throw. Answering a 422 or a 404 with a retry would be imitating a provider
 * that does not exist.
 *
 * ## Sequential, deliberately
 *
 * `OUT_OF_ORDER` is a scenario the switchboard produces on purpose. If
 * delivery were a `Promise.all`, ordering would be an accident of scheduling
 * and that scenario would sometimes pass for the wrong reason.
 */
@Injectable()
export class CallbackDispatcher {
  private readonly logger = new Logger(CallbackDispatcher.name);

  /**
   * References already announced as held by the switchboard gate.
   *
   * Without it the same "held" line would repeat every ten seconds for the
   * lifetime of the process, which buries the lines worth reading. A row is
   * announced once and then waits quietly.
   */
  private readonly announcedAsHeld = new Set<string>();

  constructor(
    private readonly http: HttpService,
    private readonly store: ProviderStore,
    private readonly config: UatConfig,
  ) {}

  /**
   * Ten seconds, not a minute: a minute is too slow to sit and watch.
   *
   * `waitForCompletion` stops a slow pass overlapping the next one - without
   * it, a callback that takes twelve seconds would be delivered twice by two
   * overlapping passes, and `DUPLICATE_CALLBACK` would stop meaning anything
   * because every scenario would be one.
   */
  @Cron(CronExpression.EVERY_10_SECONDS, {
    name: 'uat-provider-callbacks',
    waitForCompletion: true,
  })
  async dispatch(): Promise<void> {
    for (const row of this.store.due()) {
      if (!this.isReleased(row)) continue;

      await this.deliver(row);
    }
  }

  /**
   * Whether the switchboard has been turned on for this row's scenario.
   *
   * Build-order Step 6 wants one clean settlement before the other nine bands
   * are let loose; Step 9 flips `UAT_SWITCHBOARD_ENABLED` and walks them. A
   * held row keeps its undelivered outcomes and stays visible in the store, so
   * "held" and "delivered as a success" never look alike.
   */
  private isReleased(row: FakeTransaction): boolean {
    if (this.config.SWITCHBOARD_ENABLED) return true;
    if (row.scenario === SCENARIO.SUCCESS) return true;

    if (!this.announcedAsHeld.has(row.providerReference)) {
      this.announcedAsHeld.add(row.providerReference);
      this.logger.warn({
        msg: 'Holding a callback: the switchboard is off and this is not the SUCCESS band',
        providerReference: row.providerReference,
        systemReference: row.systemReference,
        scenario: row.scenario,
        pending: row.pending,
        hint: 'set UAT_SWITCHBOARD_ENABLED=true and restart to deliver it (build-order Step 9)',
      });
    }

    return false;
  }

  private async deliver(row: FakeTransaction): Promise<void> {
    const outcome = row.pending[0];

    // `due()` already guarantees a non-empty queue. Checked anyway, because
    // the alternative is posting `undefined` as a status if that ever changes.
    if (!outcome) return;

    const envelope = this.envelope(row, outcome);

    if (!envelope) {
      // Nothing can produce a Jatelindo row until Step 8 builds its fake, so
      // this is unreachable today. Dropped rather than retried: a row no
      // builder understands will not become deliverable in fifteen seconds.
      this.logger.error({
        msg: 'No payload builder for this provider; dropping the row',
        provider: row.provider,
        providerReference: row.providerReference,
      });
      this.store.forget(row.providerReference);
      return;
    }

    try {
      const response = await firstValueFrom(
        this.http.post(envelope.url, envelope.body, {
          baseURL: this.config.TRANSACTION_BASE_URL,
          timeout: POST_TIMEOUT_MS,
          // Read the status ourselves. A 500 is a protocol message here, not
          // an exception - see the class comment.
          validateStatus: () => true,
        }),
      );

      if (response.status >= 500) {
        row.attempts += 1;

        if (row.attempts >= MAX_ATTEMPTS) {
          this.logger.warn({
            msg: 'Giving up on a callback after the last attempt',
            providerReference: row.providerReference,
            systemReference: row.systemReference,
            outcome,
            attempts: row.attempts,
          });
          this.advance(row);
          return;
        }

        this.logger.warn({
          msg: 'Callback refused with a 5xx; retrying',
          providerReference: row.providerReference,
          outcome,
          httpStatus: response.status,
          attempt: row.attempts,
          retryInMs: RETRY_AFTER_MS,
        });
        row.deliverAt = Date.now() + RETRY_AFTER_MS;
        return;
      }

      this.logger.log({
        msg: 'Callback delivered',
        provider: row.provider,
        scenario: row.scenario,
        systemReference: row.systemReference,
        providerReference: row.providerReference,
        outcome,
        httpStatus: response.status,
      });

      this.advance(row);
    } catch (error) {
      // A connection refused or a timeout, not a status - the transaction app
      // being down or wedged. Retried on the same budget as a 500, because
      // from a provider's side they are the same thing.
      row.attempts += 1;
      row.deliverAt = Date.now() + RETRY_AFTER_MS;

      this.logger.error({
        msg: 'Callback POST failed',
        providerReference: row.providerReference,
        outcome,
        attempt: row.attempts,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * One outcome done with - move to the next, or forget the row.
   *
   * Shared by the acknowledged path and the gave-up path so the two cannot
   * drift. The sketch in §6.4 shifts the queue on give-up without rescheduling,
   * which would fire the *next* outcome on the following tick with no delay at
   * all - `OUT_OF_ORDER` would deliver its `SUCCESS` immediately after
   * abandoning its `FAILED`, and the gap that makes out-of-order visible would
   * be gone.
   */
  private advance(row: FakeTransaction): void {
    row.pending.shift();
    row.attempts = 0;

    if (row.pending.length > 0) {
      row.deliverAt = Date.now() + RESEND_AFTER_MS;
      return;
    }

    // Everything this transaction will ever say has been said. `NEVER_DELIVERS`
    // never reaches here - its queue starts empty, so `due()` never returns it
    // and the row stays in the store forever. That is the scenario, not a leak.
    this.store.forget(row.providerReference);
    this.announcedAsHeld.delete(row.providerReference);
  }

  private envelope(
    row: FakeTransaction,
    outcome: Outcome,
  ): { url: string; body: Record<string, unknown> } | null {
    /**
     * The one scenario that lies about identity: a callback for a reference we
     * never issued. Everything else about it is well-formed, so what is under
     * test is the lookup miss rather than the parser.
     */
    const reference =
      row.scenario === SCENARIO.UNKNOWN_REFERENCE
        ? `GHOST-${randomUUID()}`
        : row.providerReference;

    if (row.provider === PROVIDER.MOTIONPAY) {
      return {
        url: '/callback/motionpay/qris',
        body: motionPayQrisCallback(row, outcome, reference),
      };
    }

    // Jatelindo joins here at Step 8, alongside rather than replacing.
    return null;
  }
}
