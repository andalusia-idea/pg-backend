import { JatelindoConfig } from '@app/configuration';
import { TokenContext, TokenRedis, UpstreamToken } from '@app/redis';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { JATELINDO_ENDPOINT, JATELINDO_RESPONSE_CODE } from '../helper';
import { AxiosError, AxiosRequestConfig } from 'axios';
import {
  assertUpstreamSchema,
  readJwtExpSeconds,
  UpstreamException,
} from '@app/upstream';
import { HttpMethodEnum, ProviderNameEnum } from '@app/microservice';
import {
  JatelindoLoginResponseDto,
  JatelindoLoginResponseSchema,
} from '../dto';

const TOKEN_CONTEXT = TokenContext.TRANSFER;

/**
 * `A90 UNAUTHORIZED_ACCESS` as it actually arrives.
 *
 * A90 is listed in the spec's *response code* table, alongside `A00` and `T40`,
 * which means it comes back inside a 200 envelope as `status.responseCode` -
 * axios does not throw, so a check that only runs in a `catch` can never see it.
 * The spec never mentions an HTTP 401 anywhere, so this reads the envelope
 * wherever it can turn up: on a successful response, and on an error response
 * body in case a gateway in front of Jatelindo ever does answer 4xx.
 *
 * Written against `unknown` rather than a DTO because `send` is generic over the
 * response type and must not need to know which call it is carrying.
 */
function isUnauthorizedEnvelope(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;

  const status = (body as { status?: unknown }).status;
  if (typeof status !== 'object' || status === null) return false;

  return (
    (status as { responseCode?: unknown }).responseCode ===
    JATELINDO_RESPONSE_CODE.UNAUTHORIZED_ACCESS
  );
}

/**
 * Internal signal that the session token was refused.
 *
 * It exists so an expired session looks the same to `authorizedRequest` whether
 * it arrived as a 200 envelope or as a transport error, and both reach the one
 * refresh-and-retry path. It never escapes the class: `request` turns it into an
 * `UpstreamException` if it survives the retry.
 */
class JatelindoUnauthorizedError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly body: unknown,
  ) {
    super('Jatelindo responded A90 UNAUTHORIZED_ACCESS');
  }
}

@Injectable()
export class JatelindoTransferAuthService {
  private readonly logger = new Logger(JatelindoTransferAuthService.name);

  private cachedToken: UpstreamToken | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly jatelindoConfig: JatelindoConfig,
    private readonly tokenRedis: TokenRedis,
  ) {}

  async request(
    context: string,
    requestAuth: string,
    config: { method: HttpMethodEnum; url: string; data?: unknown },
  ): Promise<unknown> {
    try {
      return await this.authorizedRequest<unknown>(config, requestAuth);
    } catch (error) {
      if (error instanceof UpstreamException) throw error;

      // It survived the refresh-and-retry, so the credentials are wrong rather
      // than merely stale. Reporting it as a transport failure would send an
      // operator looking at the network for a configuration problem.
      if (error instanceof JatelindoUnauthorizedError) {
        throw new UpstreamException(
          ProviderNameEnum.JATELINDO,
          `${context} rejected: A90 UNAUTHORIZED_ACCESS, and a fresh token did not help`,
          {
            // `status` must be present. `isUpstreamTransportFailure` reads its
            // absence as "the call never got an answer", which on the payment leg
            // becomes `outcomeUnknown: true` and leaves the payout PENDING for
            // ever. A90 is the opposite: the provider answered and refused, so
            // this is a verified failure. The status is usually 200 - A90 arrives
            // in an envelope - and that is the honest value, not a placeholder.
            status: error.httpStatus,
            responseCode: JATELINDO_RESPONSE_CODE.UNAUTHORIZED_ACCESS,
            response: error.body,
          },
        );
      }

      const axiosError = error as AxiosError;
      throw new UpstreamException(
        ProviderNameEnum.JATELINDO,
        `${context} request failed`,
        {
          status: axiosError.response?.status,
          response: axiosError.response?.data,
        },
      );
    }
  }

  private async authorizedRequest<T>(
    config: AxiosRequestConfig,
    requestAuth: string,
  ): Promise<T> {
    const token = await this.getToken();

    try {
      return await this.send<T>(config, token, requestAuth);
    } catch (error) {
      if (!this.isUnauthorized(error)) throw error;

      this.logger.warn(
        'Jatelindo rejected the token; checking for a sibling refresh before minting',
      );
      this.cachedToken = null;

      const replacement = await this.tokenRedis.refreshIfUnchanged({
        providerName: ProviderNameEnum.JATELINDO,
        context: TOKEN_CONTEXT,
        staleToken: token,
        refresh: () => this.mintToken(),
      });
      this.cachedToken = replacement;

      // This retries the payment leg too, resending the same `traceNumber`.
      // That is safe on A90's own terms: the spec marks it Need Check = N, so
      // the request was refused rather than executed - and if that is ever
      // wrong, Jatelindo answers the resend with `P16 DUPLICATE_TRANSACTION`
      // instead of paying the beneficiary twice.
      return this.send<T>(config, replacement.token, requestAuth);
    }
  }

  private async send<T>(
    config: AxiosRequestConfig,
    token: string,
    requestAuth: string,
  ): Promise<T> {
    const configRequest: AxiosRequestConfig = {
      timeout: this.jatelindoConfig.TIMEOUT_MS,
      ...config,

      // After the spread, deliberately: the bearer token below is scoped to this
      // host, so a caller must not be able to redirect the request elsewhere.
      baseURL: this.jatelindoConfig.TRANSFER_BASE_URL,

      headers: {
        // Default first, so a caller can override it.
        'Content-Type': 'application/x-www-form-urlencoded',
        ...config.headers,

        // Managed here, and last on purpose: the credential and the signature
        // belong to this class. Spreading `config` over the whole object would
        // have replaced this block wholesale and dropped the caller's headers
        // instead - which is the bug this ordering fixes.
        APIKey: this.jatelindoConfig.TRANSFER_API_KEY,
        Authorization: `Bearer ${token}`,
        RequestAuth: requestAuth,
      },
    };
    this.logger.log({
      msg: 'Jatelindo request',
      method: configRequest.method,
      url: configRequest.url,
    });

    const response = await firstValueFrom(
      this.httpService.request<T>(configRequest),
    );

    // The only place A90 can be caught, because it comes back as a 200. Throwing
    // puts it on the same path as a transport 401.
    if (isUnauthorizedEnvelope(response.data)) {
      throw new JatelindoUnauthorizedError(response.status, response.data);
    }

    return response.data;
  }

  private isUnauthorized(error: unknown): boolean {
    if (error instanceof JatelindoUnauthorizedError) return true;
    if (!(error instanceof AxiosError)) return false;

    // The old check read `data['responseCode']`, one level too shallow - the
    // envelope nests it under `status` - and indexed `data` without guarding it,
    // so a response with no body raised a TypeError from inside the guard.
    return (
      error.response?.status === 401 ||
      isUnauthorizedEnvelope(error.response?.data)
    );
  }

  async getToken(): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (this.cachedToken && nowSeconds < this.cachedToken.expiresAtSeconds) {
      return this.cachedToken.token;
    }

    this.inFlight ??= this.resolveToken().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async resolveToken(): Promise<string> {
    const shared = await this.tokenRedis.getOrRefresh({
      providerName: ProviderNameEnum.JATELINDO,
      context: TOKEN_CONTEXT,
      refresh: () => this.mintToken(),
    });
    this.cachedToken = shared;
    return shared.token;
  }

  private async mintToken(): Promise<UpstreamToken> {
    const context = 'transfer token';

    // Base64 is an encoding, not encryption: `basicAuth` is exactly as sensitive
    // as the password it is built from. Neither it nor the raw pair may be logged,
    // and neither is kept in a field - both live only for this one call.
    const basicAuth = Buffer.from(
      `${this.jatelindoConfig.TRANSFER_USERNAME}:${this.jatelindoConfig.TRANSFER_PASSWORD}`,
    ).toString('base64');

    let raw: unknown;
    try {
      const response = await firstValueFrom(
        this.httpService.post(JATELINDO_ENDPOINT.LOGIN, null, {
          baseURL: this.jatelindoConfig.TRANSFER_BASE_URL,
          timeout: this.jatelindoConfig.TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            APIKey: this.jatelindoConfig.TRANSFER_API_KEY,
            Authorization: `Basic ${basicAuth}`,
          },
        }),
      );
      raw = response.data;
    } catch (error) {
      const axiosError = error as AxiosError;

      // Never log `error` itself, and never the whole axios response: both carry
      // `config.headers`, and this call's headers hold the Basic credential.
      // Routing facts only - the provider's own body travels in the exception
      // context below, where the error filter decides what is safe to surface.
      this.logger.error({
        msg: 'Jatelindo token request failed',
        status: axiosError.response?.status,
      });
      throw new UpstreamException(
        ProviderNameEnum.JATELINDO,
        `${context} request failed`,
        {
          status: axiosError.response?.status,
          response: axiosError.response?.data,
        },
      );
    }

    const parsed = assertUpstreamSchema<JatelindoLoginResponseDto>(
      ProviderNameEnum.JATELINDO,
      context,
      JatelindoLoginResponseSchema,
      raw,
    );
    if (
      parsed.status.responseCode !== JATELINDO_RESPONSE_CODE.PROCESSED ||
      parsed.LoginResponse.length <= 0
    ) {
      throw new UpstreamException(
        ProviderNameEnum.JATELINDO,
        `token request rejected: ${parsed.status.message}`,
        { status: parsed.status },
      );
    }

    const token: string = parsed.LoginResponse[0].token;
    const expiresAtSeconds = this.resolveExpiry(token);

    // Expiry only - the token is a live credential and must never reach a log
    // line, a log file, or the log shipper.
    this.logger.log({
      msg: 'Jatelindo token acquired',
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    });

    return { token, expiresAtSeconds };
  }

  private resolveExpiry(token: string): number {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const skew = this.jatelindoConfig.TOKEN_SKEW_SECONDS;

    const exp = readJwtExpSeconds(token);
    if (exp === null) {
      this.logger.warn(
        'Could not read `exp` from the Jatelindo token; not caching it',
      );
      return nowSeconds;
    }

    // If exp is already within the skew window the token is effectively dead;
    // returning `nowSeconds` forces a fresh fetch on the next call.
    return Math.max(exp - skew, nowSeconds);
  }
}
