import { HttpStatus } from '@nestjs/common';
import { MerchantSignatureFailureEnum } from './merchant.enum';

/**
 * SNAP-shaped response envelope for the merchant Public API.
 *
 * SNAP defines `responseCode` as a 7-character string:
 *
 *     HTTP status (3) + service code (2) + case code (2)
 *
 * We adopt the *shape* because merchants integrating with Indonesian PJPs and
 * aggregators (Ayolinx, IFortePay, any SNAP participant) already parse it, and
 * because embedding the HTTP status makes the code self-describing.
 *
 * We deliberately do **not** adopt SNAP's service-code registry. There, `11`
 * is Balance Inquiry and `47` is Generate QR MPM - a fixed catalogue of ~81
 * services. Emitting `2004700` for one of our endpoints would read as QR MPM
 * to anyone who knows the standard. So:
 *
 * - `00` - cross-cutting concerns (auth, signature, transport). SNAP writes
 *   this slot as `any`, meaning "applies to every service", which is exactly
 *   what these are.
 * - `90`+ - reserved for manapay business services that need their own codes.
 *   Chosen to sit outside SNAP's 01-81 range so the registries cannot be
 *   confused.
 *
 * Nothing else of SNAP is adopted: this API is outside SNAP's scope (see
 * docs/snap-standardization.md §3.2), and the envelope is the one piece with
 * real merchant-facing value.
 */
export const MERCHANT_SERVICE_CODE = {
  /** Authentication, signature verification, transport. SNAP's `any`. */
  COMMON: '00',
} as const;

/** SNAP caps `responseMessage` at 150 characters. */
export const RESPONSE_MESSAGE_MAX_LENGTH = 150;

export type MerchantResponseDto = {
  responseCode: string;
  responseMessage: string;
};

/** What the merchant receives, plus the status it is sent with. */
type MerchantFailure = MerchantResponseDto & { httpStatus: HttpStatus };

const common = (
  httpStatus: HttpStatus,
  caseCode: string,
  responseMessage: string,
): MerchantFailure => ({
  httpStatus,
  responseCode: `${httpStatus}${MERCHANT_SERVICE_CODE.COMMON}${caseCode}`,
  responseMessage,
});

/**
 * Every signature rejection, mapped to what the merchant sees.
 *
 * Distinct codes are deliberate. Collapsing these into one opaque
 * "unauthorized" is the top integration-support cost in every payment API - a
 * merchant whose clock drifted four minutes needs to see that, not a crypto
 * error. None of it helps an attacker: `clientId` is a UUIDv4, so nothing is
 * enumerable, and they already know whether they hold a valid secret.
 *
 * Note this is one place we deviate from SNAP, which lumps "Unknown Client"
 * and "Verify Client Secret Fail" together under `401 00 Unauthorized.
 * [reason]`. The support saving is worth the split.
 *
 * `REPLAYED_NONCE` is a **409**, following SNAP's own `409 00 Conflict` for a
 * reused `X-EXTERNAL-ID`. It tells the merchant "duplicate - re-sign with a
 * fresh nonce" instead of sending them to audit credentials that are fine.
 */
const MERCHANT_SIGNATURE_FAILURE: Record<
  MerchantSignatureFailureEnum,
  MerchantFailure
> = {
  MISSING_HEADER: common(
    HttpStatus.UNAUTHORIZED,
    '01',
    'Missing mandatory header',
  ),
  MALFORMED_SIGNATURE: common(
    HttpStatus.UNAUTHORIZED,
    '02',
    'Invalid X-Signature format, expected 128 hex characters (HMAC-SHA512)',
  ),
  MALFORMED_NONCE: common(
    HttpStatus.UNAUTHORIZED,
    '03',
    'Invalid X-Nonce format, expected a UUID or hex string',
  ),
  TIMESTAMP_SKEW: common(
    HttpStatus.UNAUTHORIZED,
    '04',
    'Invalid X-Timestamp, expected ISO-8601 with a UTC offset near server time',
  ),
  UNKNOWN_CLIENT: common(HttpStatus.UNAUTHORIZED, '05', 'Unknown X-Client-Id'),
  CLIENT_SUSPENDED: common(
    HttpStatus.UNAUTHORIZED,
    '06',
    'Merchant credentials are not active',
  ),
  SECRET_KEY_NOT_GENERATED: common(
    HttpStatus.UNAUTHORIZED,
    '07',
    'No secret key has been generated for this merchant',
  ),
  INVALID_SIGNATURE: common(
    HttpStatus.UNAUTHORIZED,
    '08',
    'Invalid X-Signature',
  ),
  IP_NOT_ALLOWED: common(
    HttpStatus.UNAUTHORIZED,
    '09',
    'Request origin is not in this merchant IP allowlist',
  ),
  REPLAYED_NONCE: common(
    HttpStatus.CONFLICT,
    '00',
    'X-Nonce already used, re-sign the request with a new nonce',
  ),
};

/**
 * Verification could not be performed - auth unreachable, timed out, or
 * failed internally.
 *
 * Deliberately not a 401. Answering "your signature is invalid" during an
 * outage sends every merchant to debug signing code that is fine, and tells
 * well-behaved clients to stop retrying transactions that would have
 * succeeded. 503 means "retry later", which is the truth.
 */
const SERVICE_UNAVAILABLE = common(
  HttpStatus.SERVICE_UNAVAILABLE,
  '00',
  'Service temporarily unavailable, please retry',
);

/** A guarded route the signing scheme cannot describe - our bug, not theirs. */
const INTERNAL_ERROR = common(
  HttpStatus.INTERNAL_SERVER_ERROR,
  '00',
  'Internal server error',
);

/** Success on a cross-cutting endpoint, e.g. the credential check. */
export const MERCHANT_SUCCESS: MerchantResponseDto = {
  responseCode: `${HttpStatus.OK}${MERCHANT_SERVICE_CODE.COMMON}00`,
  responseMessage: 'Successful',
};

/**
 * A failure the merchant is allowed to see, carrying its SNAP-shaped code.
 *
 * Transport-agnostic on purpose: this lives beside the failure enum so the
 * code and the reason are edited together, while rendering it to HTTP is the
 * exception filter's job in whichever app is serving.
 */
export class MerchantException extends Error {
  readonly httpStatus: HttpStatus;
  readonly response: MerchantResponseDto & { serverTime: string };

  constructor(
    failure: MerchantFailure,
    /**
     * Server time as the *verifier* saw it. Passed through from auth where
     * there is one, so a skew rejection reports the clock the decision was
     * actually made against rather than a slightly later one.
     */
    serverTime: string = new Date().toISOString(),
    /** Appended to the message - e.g. which header was missing. */
    detail?: string,
  ) {
    const responseMessage = detail
      ? `${failure.responseMessage}: ${detail}`
      : failure.responseMessage;

    super(responseMessage);
    this.name = MerchantException.name;
    this.httpStatus = failure.httpStatus;
    this.response = {
      responseCode: failure.responseCode,
      responseMessage: responseMessage.slice(0, RESPONSE_MESSAGE_MAX_LENGTH),
      serverTime,
    };
  }

  static fromMerchantSignature(
    failure: MerchantSignatureFailureEnum,
    serverTime?: string,
    detail?: string,
  ): MerchantException {
    return new MerchantException(
      MERCHANT_SIGNATURE_FAILURE[failure],
      serverTime,
      detail,
    );
  }

  static serviceUnavailable(): MerchantException {
    return new MerchantException(SERVICE_UNAVAILABLE);
  }

  static internalError(): MerchantException {
    return new MerchantException(INTERNAL_ERROR);
  }
}
