import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { PROVIDER, ProviderStore, RAIL } from '../provider.store';
import { SCENARIO, scenarioFor } from '../scenario';
import {
  fakeQrString,
  mintFakeToken,
  motionPayTimestamp,
  nextProviderReference,
  sleep,
} from './motionpay.fake.helper';

/**
 * How long `CREATE_TIMEOUT` holds the connection.
 *
 * Has to outlast the client's own `MOTIONPAY_TIMEOUT_MS` (15000 in
 * `.env.test`) with room to spare, or the scenario intermittently succeeds.
 */
const CREATE_TIMEOUT_HOLD_MS = 20_000;

/**
 * The payload shapes, hand-written on purpose.
 *
 * Not imported from `apps/transaction`'s TypeBox schemas: a fake that shares
 * our parser cannot catch a wrong parser. If these drift from the real
 * contract that is a finding, not a build error - which is the point.
 */
interface CreateQrisBody {
  terminal_id: string;
  external_id: string;
  amount: number;
  description?: string;
  session_time: number;
  fullname: string;
  email: string;
  phone_number: string;
}

/**
 * The fake MotionPay QRIS service.
 *
 * Serves the two routes the real client calls, at the paths it builds from
 * `MOTIONPAY_QRIS_ENDPOINT` against `MOTIONPAY_QRIS_BASE_URL` - so pointing
 * that env key at `http://localhost:3010/motionpay` is the entire
 * integration, and `apps/transaction` needs no code change.
 *
 * **The envelope asymmetry is the first thing that bites.** The token endpoint
 * signals success with `code: 200`, the payment endpoints with `code: 0`. It
 * is in the provider's spec, documented at `motionpay.constant.ts`, and
 * getting it backwards makes the client reject a response that looks perfectly
 * fine in the log.
 *
 * **QRIS only.** MotionPay's Transfer and Biller products are not reachable in
 * production - confirmed with the provider - so there is nothing to imitate
 * and no fake for them here. Payouts go to Jatelindo, whose fake is Step 8.
 */
@Controller('motionpay')
export class MotionPayFakeController {
  private readonly logger = new Logger(MotionPayFakeController.name);

  constructor(private readonly store: ProviderStore) {}

  /**
   * Credentials are not checked. The client sends `client_key`/`server_key`
   * and the fake hands back a token regardless: an auth failure is a scenario
   * worth having one day, but it belongs on the switchboard rather than being
   * the fake's default mood.
   */
  @Post('priv/v1/pg/token')
  token() {
    this.logger.log({ msg: 'Fake MotionPay token issued' });

    return {
      status: { code: 200, message: 'Success' },
      data: { token: mintFakeToken() },
    };
  }

  @Post('payment/api/v1/qris/payment')
  async createQris(@Body() body: CreateQrisBody) {
    const scenario = scenarioFor(body.amount);

    this.logger.log({
      msg: 'Fake MotionPay create QRIS',
      externalId: body.external_id,
      terminalId: body.terminal_id,
      amount: body.amount,
      sessionTime: body.session_time,
      scenario,
    });

    if (scenario === SCENARIO.CREATE_500) {
      // A deliberate 500 rather than a thrown bare Error, so the log reads as
      // an intended scenario and not as the fake having crashed.
      throw new InternalServerErrorException(
        'fake MotionPay: upstream unavailable',
      );
    }

    if (scenario === SCENARIO.REJECTED_AT_CREATE) {
      return {
        status: { code: 422, message: 'Unprocessable' },
        data: null,
      };
    }

    const row = this.store.accept({
      provider: PROVIDER.MOTIONPAY,
      rail: RAIL.PURCHASE,
      systemReference: body.external_id,
      providerReference: nextProviderReference(),
      amount: body.amount,
      scenario,
    });

    const response = {
      status: { code: 0, message: 'Success' },
      data: {
        transaction_id: row.providerReference,
        external_id: row.systemReference,
        amount: row.amount,
        qr_string: fakeQrString(row.providerReference),
        type: 'QRIS_DYNAMIC',
        status: 'PENDING',
        description: body.description,
        session_time: body.session_time,
        created_date: motionPayTimestamp(),
      },
    };

    if (scenario === SCENARIO.CREATE_TIMEOUT) {
      // Accepted *before* the hold, which is the whole point of this case: the
      // client gives up and records a failure while the transaction exists
      // here and will report SUCCESS later. A fake that forgot the row would
      // be testing a timeout; this tests the money.
      this.logger.warn({
        msg: 'Fake MotionPay holding the create past the client timeout',
        providerReference: row.providerReference,
        holdMs: CREATE_TIMEOUT_HOLD_MS,
      });
      await sleep(CREATE_TIMEOUT_HOLD_MS);
    }

    return response;
  }

  /**
   * **A stub, and that is deliberate.** Nothing has called this since
   * `503a602` - `confirmWithProvider` was removed, so a callback is acted on
   * without a status read. It exists so the route is not a 404 if something
   * starts calling it again, and it answers from the delivery queue rather
   * than from a recorded status, because the store does not keep one.
   *
   * Its shape being thinner than `MotionPayQrisStatusResponseSchema` allows is
   * fine: every field it omits is optional there. Fill it in when something
   * depends on it.
   */
  @Get('payment/api/v1/qris/payment-status/:transactionId')
  status(@Param('transactionId') transactionId: string) {
    const row = this.store.byProviderReference(transactionId);

    if (!row) {
      this.logger.warn({
        msg: 'Fake MotionPay status for an unknown transaction',
        transactionId,
      });
      return { status: { code: 404, message: 'Not found' }, data: null };
    }

    return {
      status: { code: 0, message: 'Success' },
      data: {
        transaction_id: row.providerReference,
        external_id: row.systemReference,
        amount: row.amount,
        status: row.pending.length === 0 ? 'SUCCESS' : 'PENDING',
        created_date: motionPayTimestamp(new Date(row.createdAt)),
      },
    };
  }
}
