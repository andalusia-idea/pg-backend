import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { MotionPayConfig } from '@app/configuration';
import { assertUpstreamSchema, UpstreamException } from '@app/upstream';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';
import {
  MOTIONPAY_ENDPOINT,
  MOTIONPAY_STATUS_CODE,
} from './motionpay.constant';
import {
  MotionPayTokenRequestDto,
  MotionPayTokenResponseDto,
  MotionPayTokenResponseSchema,
} from './dto';
import { ProviderNameEnum } from '@app/microservice';

interface CachedToken {
  token: string;
  /** Epoch seconds after which the token must not be reused. */
  expiresAtSeconds: number;
}

@Injectable()
export class MotionPayAuthService {
  private readonly logger = new Logger(MotionPayAuthService.name);

  private cachedToken: CachedToken | null = null;
  /** Shared in-flight fetch, so a burst at cold start issues one token request. */
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly motionPayConfig: MotionPayConfig,
  ) {}

  /**
   * Perform an authenticated request against MotionPay.
   *
   * On a 401 the token is discarded and the request retried exactly once with a
   * fresh token — MotionPay's token TTL is documented inconsistently (7 vs 30
   * days), so treating the server's own rejection as the signal is more
   * reliable than trusting either number.
   */
  async authorizedRequest<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      return await this.send<T>(config, await this.getToken());
    } catch (error) {
      if (!this.isUnauthorized(error)) throw error;

      this.logger.warn(
        'MotionPay rejected the cached token; refreshing and retrying once',
      );
      this.cachedToken = null;
      return this.send<T>(config, await this.getToken());
    }
  }

  private async send<T>(config: AxiosRequestConfig, token: string): Promise<T> {
    const configRequest: AxiosRequestConfig = {
      baseURL: this.motionPayConfig.BASE_URL,
      timeout: this.motionPayConfig.TIMEOUT_MS,
      ...config,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...config.headers,
      },
    };

    // Never log `configRequest` — it carries the bearer token in its headers.
    // Log the routing facts only.
    this.logger.debug({
      msg: 'MotionPay request',
      method: configRequest.method,
      url: configRequest.url,
    });

    const response = await firstValueFrom(
      this.httpService.request<T>(configRequest),
    );
    return response.data;
  }

  private isUnauthorized(error: unknown): boolean {
    return (
      error instanceof AxiosError &&
      error.response?.status === MOTIONPAY_STATUS_CODE.UNAUTHORIZED
    );
  }

  /** Returns a valid token, reusing the cached one until it is close to expiry. */
  async getToken(): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (this.cachedToken && nowSeconds < this.cachedToken.expiresAtSeconds) {
      return this.cachedToken.token;
    }

    // Collapse concurrent misses onto one request rather than stampeding.
    this.inFlight ??= this.fetchToken().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async fetchToken(): Promise<string> {
    const body: MotionPayTokenRequestDto = {
      client_key: this.motionPayConfig.CLIENT_KEY,
      server_key: this.motionPayConfig.SERVER_KEY,
    };

    let raw: unknown;
    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(MOTIONPAY_ENDPOINT.TOKEN, body, {
          baseURL: this.motionPayConfig.BASE_URL,
          timeout: this.motionPayConfig.TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      raw = response.data;
    } catch (error) {
      // Never let the credentials reach a log or an exception message.
      const axiosError = error as AxiosError;
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        'token request failed',
        {
          status: axiosError.response?.status,
          response: axiosError.response?.data,
        },
      );
    }

    const parsed = assertUpstreamSchema<MotionPayTokenResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      MotionPayTokenResponseSchema,
      raw,
      'token',
    );

    // The token endpoint signals success with 200, not 0 — see motionpay.constant.ts.
    if (parsed.status.code !== MOTIONPAY_STATUS_CODE.TOKEN_OK || !parsed.data) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `token request rejected: ${parsed.status.message}`,
        { status: parsed.status },
      );
    }

    const token: string = parsed.data.token;
    const expiresAtSeconds = this.resolveExpiry(token);
    this.cachedToken = { token, expiresAtSeconds };

    // Expiry only — the token is a live credential and must never reach a log
    // line, a log file, or the log shipper.
    this.logger.log({
      msg: 'MotionPay token acquired',
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    });

    return token;
  }

  /**
   * Derive the cache deadline from the token's own JWT `exp` claim.
   *
   * MotionPay's docs state both "30 days" and "7 days" for token validity and
   * explicitly flag the contradiction. The token is a JWT, so reading `exp` is
   * correct under either reading and self-corrects if they change it. If `exp`
   * is unreadable we fall back to a single-use token rather than guessing a
   * long TTL — a redundant token call is cheap, a stale token is an outage.
   */
  private resolveExpiry(token: string): number {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const skew = this.motionPayConfig.TOKEN_SKEW_SECONDS;

    const exp = this.readJwtExp(token);
    if (exp === null) {
      this.logger.warn(
        'Could not read `exp` from the MotionPay token; not caching it',
      );
      return nowSeconds;
    }

    // If exp is already within the skew window the token is effectively dead;
    // returning `nowSeconds` forces a fresh fetch on the next call.
    return Math.max(exp - skew, nowSeconds);
  }

  private readJwtExp(token: string): number | null {
    try {
      const payloadSegment = token.split('.')[1];
      if (!payloadSegment) return null;

      const payload: unknown = JSON.parse(
        Buffer.from(payloadSegment, 'base64url').toString('utf8'),
      );

      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('exp' in payload)
      ) {
        return null;
      }

      const exp = (payload as { exp: unknown }).exp;
      return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
    } catch {
      return null;
    }
  }
}
