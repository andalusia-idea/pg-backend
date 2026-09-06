import { HttpStatus } from '@nestjs/common';
import {
  MERCHANT_SERVICE_CODE,
  MerchantException,
  MerchantFailure,
  merchantFailure,
} from './merchant.exception';
import { TransactionFailureEnum } from './transaction.enum';

/**
 * Case codes, following SNAP's convention where it has one.
 *
 * `01` Invalid Field Format and `02` Invalid Mandatory Field are SNAP's own
 * and mean the same thing here, so a merchant who has integrated with any
 * other SNAP participant already knows how to read them. The rest sit at `00`
 * (the general case for their status) rather than inventing numbers SNAP would
 * one day assign different meanings to.
 */
const CASE = {
  GENERAL: '00',
  INVALID_FIELD_FORMAT: '01',
  INVALID_MANDATORY_FIELD: '02',
  /** SNAP's `403 xx 02`. */
  INSUFFICIENT_FUNDS: '02',
  INVALID_BENEFICIARY: '03',
  UNSUPPORTED_BANK_CODE: '04',
} as const;

const disbursement = (
  httpStatus: HttpStatus,
  caseCode: string,
  responseMessage: string,
): MerchantFailure =>
  merchantFailure(
    httpStatus,
    MERCHANT_SERVICE_CODE.DISBURSEMENT,
    caseCode,
    responseMessage,
  );

const purchase = (
  httpStatus: HttpStatus,
  caseCode: string,
  responseMessage: string,
): MerchantFailure =>
  merchantFailure(
    httpStatus,
    MERCHANT_SERVICE_CODE.PURCHASE,
    caseCode,
    responseMessage,
  );

/**
 * Every business failure a transaction endpoint can return.
 *
 * The split between 4xx and 5xx here is the only thing that tells a merchant
 * whether to fix their request or retry it unchanged, so it is worth being
 * literal about: 4xx means *do not retry this payload as-is*, 5xx means *this
 * may well succeed on retry*.
 */
const TRANSACTION_FAILURE: Record<TransactionFailureEnum, MerchantFailure> = {
  INVALID_FIELD_FORMAT: purchase(
    HttpStatus.BAD_REQUEST,
    CASE.INVALID_FIELD_FORMAT,
    'Invalid field format',
  ),
  INVALID_MANDATORY_FIELD: purchase(
    HttpStatus.BAD_REQUEST,
    CASE.INVALID_MANDATORY_FIELD,
    'Missing mandatory field',
  ),
  /**
   * 403, not 401. Their signature verified - the credentials are good. What is
   * missing is a fee configuration for this payment method, which is something
   * only we can fix. Answering 401 would send them to audit signing code that
   * is working.
   */
  TRANSACTION_NOT_PERMITTED: purchase(
    HttpStatus.FORBIDDEN,
    CASE.GENERAL,
    'This payment method is not enabled for your account, please contact support',
  ),
  /**
   * 409, matching SNAP's treatment of a reused `partnerReferenceNo`.
   *
   * Deliberately not 400: a duplicate is very often a *retry of a request that
   * already succeeded*, not a malformed one. 409 tells the merchant "we already
   * have this - go look it up" rather than "your payload is wrong".
   */
  DUPLICATE_MERCHANT_REFERENCE: purchase(
    HttpStatus.CONFLICT,
    CASE.GENERAL,
    'merchantReference has already been used, use a new one or query the original transaction',
  ),
  /**
   * 502: we reached the provider and they refused. The reason is logged in
   * full but not returned - a provider's raw rejection text is their internal
   * vocabulary, and forwarding it trains merchants to parse strings we do not
   * control and cannot promise to keep stable.
   */
  UPSTREAM_REJECTED: purchase(
    HttpStatus.BAD_GATEWAY,
    CASE.GENERAL,
    'Payment provider rejected the request, please retry or contact support',
  ),
  /**
   * 504, and the most dangerous state in the whole flow: a timeout means we do
   * not know whether the QR was created. The transaction is left PENDING on
   * purpose so reconciliation can resolve it - never FAILED, which would assert
   * something we cannot know.
   */
  UPSTREAM_TIMEOUT: purchase(
    HttpStatus.GATEWAY_TIMEOUT,
    CASE.GENERAL,
    'Payment provider did not respond in time, check the transaction status before retrying',
  ),
  SERVICE_UNAVAILABLE: purchase(
    HttpStatus.SERVICE_UNAVAILABLE,
    CASE.GENERAL,
    'Service temporarily unavailable, please retry',
  ),
  /**
   * 400: the merchant sent an account number the bank does not recognise. Their
   * payload is wrong, and no retry of it will work.
   */
  INVALID_BENEFICIARY: disbursement(
    HttpStatus.BAD_REQUEST,
    CASE.INVALID_BENEFICIARY,
    'Beneficiary account could not be verified, check the bank code and account number',
  ),
  UNSUPPORTED_BANK_CODE: disbursement(
    HttpStatus.BAD_REQUEST,
    CASE.UNSUPPORTED_BANK_CODE,
    'Unsupported bank or wallet code',
  ),
  /**
   * 403, following SNAP's `403 xx 02` for insufficient funds. Not the
   * merchant's fault - our deposit is short - but returning a 5xx would tell
   * them to retry into the same wall, and returning success would be a lie.
   */
  INSUFFICIENT_DEPOSIT: disbursement(
    HttpStatus.FORBIDDEN,
    CASE.INSUFFICIENT_FUNDS,
    'Payout could not be funded, please contact support',
  ),
  INTERNAL_ERROR: purchase(
    HttpStatus.INTERNAL_SERVER_ERROR,
    CASE.GENERAL,
    'Internal server error',
  ),
};

/**
 * A business failure on a merchant transaction endpoint.
 *
 * **Extends {@link MerchantException} deliberately.** Nest selects an exception
 * filter with `exception instanceof Metatype`, so the existing
 * `@Catch(MerchantException)` filter renders this too - same envelope, same
 * `Retry-After` handling, nothing new to register. A merchant sees one response
 * shape for every failure, whether it came from the signature guard or from
 * three services deep in the purchase flow.
 *
 * What this class adds is a registry of *transaction* failures kept in its own
 * file, so the code and the reason for it are edited together and the
 * cross-cutting codes in `merchant.exception.ts` stay untouched as business
 * endpoints multiply.
 */
export class TransactionException extends MerchantException {
  readonly failure: TransactionFailureEnum;

  constructor(
    failure: TransactionFailureEnum,
    /** Appended to the message - which field, which reference. */
    detail?: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(
      TRANSACTION_FAILURE[failure],
      new Date().toISOString(),
      detail,
      retryAfterSeconds,
    );
    this.name = TransactionException.name;
    this.failure = failure;
  }

  static invalidFieldFormat(detail?: string): TransactionException {
    return new TransactionException(
      TransactionFailureEnum.INVALID_FIELD_FORMAT,
      detail,
    );
  }

  static invalidMandatoryField(detail?: string): TransactionException {
    return new TransactionException(
      TransactionFailureEnum.INVALID_MANDATORY_FIELD,
      detail,
    );
  }

  static transactionNotPermitted(detail?: string): TransactionException {
    return new TransactionException(
      TransactionFailureEnum.TRANSACTION_NOT_PERMITTED,
      detail,
    );
  }

  static duplicateMerchantReference(detail?: string): TransactionException {
    return new TransactionException(
      TransactionFailureEnum.DUPLICATE_MERCHANT_REFERENCE,
      detail,
    );
  }

  static upstreamRejected(): TransactionException {
    return new TransactionException(TransactionFailureEnum.UPSTREAM_REJECTED);
  }

  static upstreamTimeout(): TransactionException {
    return new TransactionException(TransactionFailureEnum.UPSTREAM_TIMEOUT);
  }

  static serviceUnavailable(): TransactionException {
    return new TransactionException(TransactionFailureEnum.SERVICE_UNAVAILABLE);
  }

  static internalError(): TransactionException {
    return new TransactionException(TransactionFailureEnum.INTERNAL_ERROR);
  }

  static invalidBeneficiary(detail?: string): TransactionException {
    return new TransactionException(
      TransactionFailureEnum.INVALID_BENEFICIARY,
      detail,
    );
  }

  static unsupportedBankCode(detail?: string): TransactionException {
    return new TransactionException(
      TransactionFailureEnum.UNSUPPORTED_BANK_CODE,
      detail,
    );
  }

  static insufficientDeposit(): TransactionException {
    return new TransactionException(
      TransactionFailureEnum.INSUFFICIENT_DEPOSIT,
    );
  }
}
