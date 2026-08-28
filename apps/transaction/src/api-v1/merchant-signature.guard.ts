import { MerchantSignatureConfig } from '@app/configuration';
import {
  FilterMerchantSignatureValidationDto,
  HttpMethodEnum,
  isHttpMethodEnum,
  MerchantException,
  MerchantSignatureAuthClient,
  MerchantSignatureFailureEnum,
} from '@app/microservice';
import {
  EMPTY_BODY_SHA256,
  isTimestampWithin,
  isValidNonce,
  isValidSignatureFormat,
  sha256Hex,
} from '@app/signature';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  RawBodyRequest,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { MERCHANT_USER_ID_KEY } from './merchant-user-id.decorator';

/** The four headers a merchant must send. There is no algorithm header. */
const REQUIRED_HEADERS = [
  'x-client-id',
  'x-timestamp',
  'x-nonce',
  'x-signature',
] as const;

type RequiredHeader = (typeof REQUIRED_HEADERS)[number];

@Injectable()
export class MerchantSignatureGuard implements CanActivate {
  private readonly logger = new Logger(MerchantSignatureGuard.name);

  constructor(
    private readonly merchantSignatureAuthClient: MerchantSignatureAuthClient,
    private readonly merchantSignatureConfig: MerchantSignatureConfig,
    private readonly cls: ClsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // A globally-registered guard also fires for TCP `@MessagePattern`
    // handlers, which carry no HTTP headers. Kept even though this guard is
    // applied per-controller today, so promoting it to APP_GUARD later cannot
    // silently break every internal call.
    if (context.getType() !== 'http') return true;

    const req = context
      .switchToHttp()
      .getRequest<RawBodyRequest<FastifyRequest>>();

    const headers = this.readRequiredHeaders(req);
    const httpMethod = this.readMethod(req);
    this.assertContentType(req, httpMethod);
    this.assertFormat(headers);

    const payload: FilterMerchantSignatureValidationDto = {
      clientId: headers['x-client-id'],
      timestampIso: headers['x-timestamp'],
      nonce: headers['x-nonce'],
      signature: headers['x-signature'],
      httpMethod,
      // Verbatim, query string included. This app sets no global prefix, so
      // there is nothing to strip - see docs/merchant-signature.md §5.2.
      endpoint: req.url,
      bodyHash: req.rawBody ? sha256Hex(req.rawBody) : EMPTY_BODY_SHA256,
      // Fastify resolves this from `X-Forwarded-For` only for proxies named in
      // `trustProxy` (see main.ts); otherwise it is the socket address. Null
      // when it cannot be determined at all, which auth treats as "not
      // allowed" for any merchant that has an allowlist - a misconfigured
      // trustProxy must not silently disable the control.
      ipAddress: req.ip || null,
    };

    const result = await this.verify(payload);

    if (!result.isValid || result.userId === null) {
      throw MerchantException.fromMerchantSignature(
        result.reason ?? MerchantSignatureFailureEnum.INVALID_SIGNATURE,
        result.serverTime,
      );
    }

    this.cls.set(MERCHANT_USER_ID_KEY, result.userId);
    return true;
  }

  /**
   * Ask auth to verify, turning any transport failure into a 503.
   *
   * The error type does not survive the TCP hop - Nest replaces it with a
   * generic `{ status: 'error', message: 'Internal server error' }`, and a
   * dead process or a timeout arrive in other shapes again. All of them mean
   * one thing here: verification could not be performed. The real cause is
   * logged inside auth, which is where it can be acted on.
   */
  private async verify(payload: FilterMerchantSignatureValidationDto) {
    try {
      return await this.merchantSignatureAuthClient.validateSignature(payload);
    } catch (error) {
      this.logger.error({
        msg: 'Merchant signature verification unavailable',
        clientId: payload.clientId,
        error,
      });
      throw MerchantException.serviceUnavailable();
    }
  }

  /**
   * Pull the four headers, rejecting anything absent or repeated.
   *
   * A repeated header arrives as an array. Silently taking `[0]` would let a
   * caller send two signatures and have one quietly ignored, so a duplicate
   * counts as absent.
   */
  private readRequiredHeaders(
    req: FastifyRequest,
  ): Record<RequiredHeader, string> {
    const missing: string[] = [];
    const values = {} as Record<RequiredHeader, string>;

    for (const name of REQUIRED_HEADERS) {
      const value = req.headers[name];
      if (typeof value !== 'string' || value.length === 0) {
        missing.push(name);
        continue;
      }
      values[name] = value;
    }

    if (missing.length > 0) {
      throw MerchantException.fromMerchantSignature(
        MerchantSignatureFailureEnum.MISSING_HEADER,
        undefined,
        missing.join(', '),
      );
    }

    return values;
  }

  private readMethod(req: FastifyRequest): HttpMethodEnum {
    if (isHttpMethodEnum(req.method)) return req.method;

    // Unreachable while the API exposes only GET and POST. If it fires, a
    // route was guarded that the signing scheme cannot describe - our bug,
    // not the merchant's, so say that rather than blame their signature.
    this.logger.error({
      msg: 'Guarded route uses a method the signature scheme cannot sign',
      method: req.method,
      url: req.url,
    });
    throw MerchantException.internalError();
  }

  /**
   * Only POST is checked, and only by prefix.
   *
   * A GET carries no body and merchants will not send `Content-Type` at all,
   * so requiring it would reject every valid read. `application/json;
   * charset=utf-8` is entirely standard, so an exact match would reject that
   * too.
   */
  private assertContentType(
    req: FastifyRequest,
    httpMethod: HttpMethodEnum,
  ): void {
    if (httpMethod !== HttpMethodEnum.POST) return;

    const contentType = req.headers['content-type'];
    if (
      typeof contentType !== 'string' ||
      !contentType.startsWith('application/json')
    ) {
      throw MerchantException.fromMerchantSignature(
        MerchantSignatureFailureEnum.MISSING_HEADER,
        undefined,
        'content-type must be application/json',
      );
    }
  }

  /**
   * Cheap local checks, before any network call.
   *
   * Rejecting malformed input here means garbage never costs a TCP hop - an
   * attacker produces it far faster than valid signatures - and it lets the
   * TCP contract stay strictly typed, so anything that reaches auth and fails
   * its schema is a bug in this guard rather than a merchant error.
   */
  private assertFormat(headers: Record<RequiredHeader, string>): void {
    if (!isValidSignatureFormat(headers['x-signature'])) {
      throw MerchantException.fromMerchantSignature(
        MerchantSignatureFailureEnum.MALFORMED_SIGNATURE,
      );
    }

    if (!isValidNonce(headers['x-nonce'])) {
      throw MerchantException.fromMerchantSignature(
        MerchantSignatureFailureEnum.MALFORMED_NONCE,
      );
    }

    // Rejects a timestamp with no UTC offset as malformed rather than skewed:
    // without one, `new Date` resolves against the server's local zone, so the
    // same string means different instants on a WIB host and a UTC host.
    const withinTolerance = isTimestampWithin({
      timestampIso: headers['x-timestamp'],
      toleranceSeconds:
        this.merchantSignatureConfig.TIMESTAMP_TOLERANCE_SECONDS,
    });

    if (!withinTolerance) {
      throw MerchantException.fromMerchantSignature(
        MerchantSignatureFailureEnum.TIMESTAMP_SKEW,
      );
    }
  }
}
