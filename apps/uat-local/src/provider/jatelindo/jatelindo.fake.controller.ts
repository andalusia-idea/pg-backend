import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Post,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UatConfig } from '../../config';
import { PROVIDER, ProviderStore, RAIL } from '../provider.store';
import { SCENARIO, scenarioFor } from '../scenario';
import {
  JATELINDO_CODE,
  jatelindoEnvelope,
  jatelindoTransactionNumber,
  mintJatelindoToken,
  nextJpaReference,
  sleep,
} from './jatelindo.fake.helper';

/**
 * How long `CREATE_TIMEOUT` holds the connection.
 *
 * Has to outlast `JATELINDO_TIMEOUT_MS` (15000 in `.env.test`) with room to
 * spare, or the scenario intermittently succeeds.
 */
const CREATE_TIMEOUT_HOLD_MS = 20_000;

/** What the pool claims to hold. Large enough that nothing is ever refused. */
const POOL_BALANCE = '900000000.00';

/**
 * The request shapes, hand-written on purpose.
 *
 * Not imported from `apps/transaction`'s TypeBox schemas: a fake that shares
 * our parser cannot catch a wrong parser.
 *
 * **Every field arrives as a string, and the nulls do not arrive at all.** The
 * client sets `Content-Type: application/x-www-form-urlencoded` as the default
 * for every call in `JatelindoTransferAuthService.send`, so Fastify's
 * urlencoded parser hands over strings whatever the client's own DTO says, and
 * `description: null` / `email: null` are dropped by the serialiser rather than
 * arriving as `null`. `amount` is already `Type.String()` on the real request
 * schema, so that part is no surprise; the missing nulls are what catch people.
 * Hence every field below is optional.
 */
interface InquiryBody {
  accountNo?: string;
  amount?: string;
  channelId?: string;
  phoneNo?: string;
  name?: string;
}

interface SingleTransferBody extends InquiryBody {
  traceNumber?: string;
}

interface TransactionStatusBody {
  traceNumber?: string;
}

/**
 * The fake Jatelindo transfer service.
 *
 * Serves the five routes the real client builds from `JATELINDO_ENDPOINT`, so
 * pointing `JATELINDO_TRANSFER_BASE_URL` at `http://localhost:3010/jatelindo`
 * is the whole integration and `apps/transaction` needs no code change. The
 * controller prefix plus each route has to reproduce those paths exactly -
 * `/Host/Transfer/...`, capitals included - which is why the prefix carries
 * three segments rather than one.
 *
 * **Nothing is authenticated, and the client does not know that.** It still
 * mints a session token, hashes `TRANSFER_SECRET` into a `RequestAuth`
 * signature for every call, and sends both - all of which runs whether or not
 * anybody checks it. A rejected-credentials case is worth having one day; it
 * belongs on the switchboard rather than being the fake's default mood.
 *
 * **Every route answers HTTP 200, not Nest's default 201.** Jatelindo's whole
 * protocol is a 200 carrying a response code in the envelope - that is the
 * premise `isUnauthorizedEnvelope` rests on, and the reason `A90` cannot be
 * caught in a `catch` block at all. A fake answering 201 would make that
 * comment read false, and would be the thing that broke if anyone ever added a
 * `status === 200` check.
 */
@Controller('jatelindo/Host/Transfer')
export class JatelindoFakeController {
  private readonly logger = new Logger(JatelindoFakeController.name);

  constructor(
    private readonly store: ProviderStore,
    private readonly config: UatConfig,
  ) {}

  @Post('Session/Login')
  @HttpCode(HttpStatus.OK)
  login() {
    this.logger.log({ msg: 'Fake Jatelindo session token issued' });

    return {
      LoginResponse: [{ token: mintJatelindoToken() }],
      status: jatelindoEnvelope(JATELINDO_CODE.PROCESSED, 'Login success'),
    };
  }

  @Post('Account/BalanceInquiry')
  @HttpCode(HttpStatus.OK)
  balanceInquiry() {
    return {
      BalanceInquiryResponse: [
        {
          accountBalance: POOL_BALANCE,
          reservedAmount: '0.00',
          member: { name: 'UAT', username: 'uat' },
          account: { name: 'UAT Pool', id: '1' },
        },
      ],
      status: jatelindoEnvelope(JATELINDO_CODE.PROCESSED, 'Success'),
    };
  }

  /**
   * The beneficiary-name read, which always resolves.
   *
   * **Always `A00`, including for the failure bands.** `createTransfer` checks
   * this leg's code and raises an `INQUIRY`-step exception when it is not
   * SUCCESS, so rejecting here would make `REJECTED_AT_CREATE` fail at the
   * wrong leg - and the inquiry leg is the uninteresting one, because nothing
   * has moved and `outcomeUnknown` is false either way. The band is refused at
   * the payment leg instead, where a verified rejection has to be told apart
   * from a call that never got an answer.
   *
   * An "account not found" scenario belongs here when it is wanted: this is
   * where the real provider validates the destination, and it is the only leg
   * that can prove we do not pay an account nobody confirmed exists.
   */
  @Post('Transaction/Inquiry')
  @HttpCode(HttpStatus.OK)
  inquiry(@Body() body: InquiryBody) {
    const accountNo = body.accountNo || body.phoneNo || '';

    this.logger.log({
      msg: 'Fake Jatelindo account inquiry',
      accountNo,
      channelId: body.channelId,
      amount: body.amount,
    });

    return {
      inquiryInfo: {
        /**
         * The name we invent, not `body.name`.
         *
         * The client replaces the merchant's spelling with this one and records
         * it as the confirmed holder, because a merchant's own spelling is not
         * evidence of who owns the account. Echoing the request back would make
         * a wrong name indistinguishable from a confirmed one, and that
         * substitution is exactly what the stored row should show happened.
         */
        accountName: 'UAT BENEFICIARY',
        accountNo,
        bankName: 'UAT BANK',
        customerAdmin: '0',
      },
      referenceID: `inq-${randomUUID()}`,
      status: jatelindoEnvelope(JATELINDO_CODE.PROCESSED, 'Success'),
    };
  }

  @Post('Transaction/SingleTransfer')
  @HttpCode(HttpStatus.OK)
  async singleTransfer(@Body() body: SingleTransferBody) {
    const amount = Number(body.amount ?? 0);
    const traceNumber = body.traceNumber ?? '';
    const accountNo = body.accountNo || body.phoneNo || '';
    const scenario = scenarioFor(amount);
    const jpaReferenceNo = nextJpaReference();

    this.logger.log({
      msg: 'Fake Jatelindo single transfer',
      traceNumber,
      accountNo,
      amount,
      scenario,
    });

    // A transport failure, before any envelope exists. A deliberate 500 rather
    // than a bare Error, so the log reads as an intended scenario and not as
    // the fake having crashed.
    if (scenario === SCENARIO.CREATE_500) {
      throw new InternalServerErrorException(
        'fake Jatelindo: upstream unavailable',
      );
    }

    /**
     * `T40` maps to FAILED, so the client raises a verified rejection: the
     * provider answered, and the answer was no. `outcomeUnknown` stays false
     * and the row is marked FAILED, which is only safe *because* an answer
     * arrived.
     *
     * The empty `DisbursementResponse` here is the provider's own shape for a
     * rejection, and is not the empty-array probe below: this path throws
     * before `buildTransferResponse` ever indexes the array.
     */
    if (scenario === SCENARIO.REJECTED_AT_CREATE) {
      return {
        DisbursementResponse: [],
        traceNumber,
        jpaReferenceNo,
        status: jatelindoEnvelope(
          JATELINDO_CODE.FAILED,
          'Transaction rejected',
        ),
      };
    }

    const row = this.store.accept({
      provider: PROVIDER.JATELINDO,
      rail: RAIL.DISBURSEMENT,
      systemReference: traceNumber,
      providerReference: jpaReferenceNo,
      destinationAccount: accountNo,
      amount,
      scenario,
    });

    /**
     * The empty-array probe, which is build-order Step 8d.
     *
     * The schema permits `DisbursementResponse: []` and `buildTransferResponse`
     * reads `[0].transactionNumber` with no non-empty check, so an accepted
     * transfer carrying nothing raises a `TypeError` *inside* the client rather
     * than a handled upstream error. It is behind a flag rather than a scenario
     * band for two reasons: the bands are the pay-in vocabulary and are keyed
     * on an amount a merchant chooses, and this is a probe you point at one
     * request deliberately rather than a mood the provider is ever in.
     */
    const empty = this.config.JATELINDO_EMPTY_DISBURSEMENT;

    if (empty) {
      this.logger.warn({
        msg: 'Answering A01 with an empty DisbursementResponse on purpose',
        traceNumber,
        jpaReferenceNo,
        hint: 'UAT_JATELINDO_EMPTY_DISBURSEMENT is on - build-order Step 8d',
      });
    }

    /**
     * `A01 REQUESTED` - accepted, outcome to follow by callback. The normal
     * answer on this rail, and it maps to PENDING rather than to a terminal
     * state because the spec marks it `Need Check = Y`.
     */
    const response = {
      DisbursementResponse: empty
        ? []
        : [
            {
              transactionType: { name: 'SINGLE_TRANSFER' },
              traceNumber: row.systemReference,
              sourceAccount: { fromName: 'UAT Pool', fromUsername: 'uat' },
              transactionNumber: jatelindoTransactionNumber(
                row.providerReference,
              ),
              destinationAccount: {
                accountName: 'UAT BENEFICIARY',
                accountNo,
                bankName: 'UAT BANK',
              },
            },
          ],
      traceNumber: row.systemReference,
      jpaReferenceNo: row.providerReference,
      status: jatelindoEnvelope(
        JATELINDO_CODE.REQUESTED,
        'Transaction requested',
      ),
    };

    if (scenario === SCENARIO.CREATE_TIMEOUT) {
      // Accepted *before* the hold, which is the point of this case: the client
      // gives up and reports `outcomeUnknown`, while the transfer exists here
      // and will report SUCCESS later. A fake that forgot the row would be
      // testing a timeout; this tests the money.
      this.logger.warn({
        msg: 'Fake Jatelindo holding the transfer past the client timeout',
        jpaReferenceNo,
        holdMs: CREATE_TIMEOUT_HOLD_MS,
      });
      await sleep(CREATE_TIMEOUT_HOLD_MS);
    }

    return response;
  }

  /**
   * **A stub, and that is deliberate.** Nothing has called this since
   * `503a602` removed `confirmWithProvider`, so an upstream outcome is acted on
   * without a status read. It exists so the route is not a 404 if something
   * starts calling it again.
   *
   * It answers `S84 NO_TRANSACTION` with an empty array rather than inventing a
   * state, because the store is keyed on `jpaReferenceNo` and this route is
   * given a `traceNumber`. Filling it in needs a second index on the store; add
   * both together when a confirmation step comes back.
   */
  @Post('Transaction/Status')
  @HttpCode(HttpStatus.OK)
  transactionStatus(@Body() body: TransactionStatusBody) {
    this.logger.warn({
      msg: 'Fake Jatelindo transaction status called - nothing should be calling this',
      traceNumber: body.traceNumber,
      known: this.store.all().length,
    });

    return {
      traceNumber: body.traceNumber ?? '',
      jpaReferenceNo: '',
      TransactionStatusResponse: [],
      status: jatelindoEnvelope(
        JATELINDO_CODE.NO_TRANSACTION,
        'No transaction found for that traceNumber',
      ),
    };
  }
}
