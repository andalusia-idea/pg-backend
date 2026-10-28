import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { MotionPayConfig } from '@app/configuration';
import {
  assertUpstreamSchema,
  readJwtExpSeconds,
  UpstreamException,
} from '@app/upstream';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { MOTIONPAY_QRIS_ENDPOINT, MOTIONPAY_STATUS_CODE } from '../helper';
import {
  MotionPayTokenRequestDto,
  MotionPayTokenResponseDto,
  MotionPayTokenResponseSchema,
} from '../dto';
import { ProviderNameEnum } from '@app/microservice';
import { TokenContext, TokenRedis, UpstreamToken } from '@app/redis';

/** Which of MotionPay's three products this service authenticates. */
const TOKEN_CONTEXT = TokenContext.QRIS;

@Injectable()
export class MotionPayQrisAuthService {
  private readonly logger = new Logger(MotionPayQrisAuthService.name);

  private cachedToken: UpstreamToken | null = null;
  /** Shared in-flight fetch, so a burst at cold start issues one token request. */
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly motionPayConfig: MotionPayConfig,
    private readonly tokenRedis: TokenRedis,
  ) {}

  /**
   * Perform an authenticated request against MotionPay.
   *
   * On a 401 the request is retried exactly once — MotionPay's token TTL is
   * documented inconsistently (7 vs 30 days), so treating the server's own
   * rejection as the signal is more reliable than trusting either number.
   *
   * **The retry adopts before it mints.** A 401 under a revoking upstream
   * usually means a sibling replica refreshed and invalidated us, so the
   * replacement comes from whatever they published. Only when nobody has
   * published a different token do we call the token endpoint ourselves.
   */
  async authorizedRequest<T>(config: AxiosRequestConfig): Promise<T> {
    // Resolved before the try, so a failure to obtain a token is not mistaken
    // for the business call being refused - and so the 401 handler knows which
    // token actually failed.
    const token = await this.getToken();

    try {
      return await this.send<T>(config, token);
    } catch (error) {
      if (!this.isUnauthorized(error)) throw error;

      this.logger.warn(
        'MotionPay rejected the token; checking for a sibling refresh before minting',
      );
      this.cachedToken = null;

      // Not a blind refresh: if another replica has already published a
      // different token we adopt it. Minting unconditionally here is what
      // turns one 401 into a refresh storm when the upstream revokes on
      // reissue.
      const replacement = await this.tokenRedis.refreshIfUnchanged({
        providerName: ProviderNameEnum.MOTIONPAY,
        context: TOKEN_CONTEXT,
        staleToken: token,
        refresh: () => this.mintToken(),
      });
      this.cachedToken = replacement;

      return this.send<T>(config, replacement.token);
    }
  }

  private async send<T>(config: AxiosRequestConfig, token: string): Promise<T> {
    const configRequest: AxiosRequestConfig = {
      baseURL: this.motionPayConfig.QRIS_BASE_URL,
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

    // Collapse concurrent misses *within this pod* onto one request; the
    // Redis lock does the same job across pods.
    this.inFlight ??= this.resolveToken().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  /**
   * Take whatever the replicas already share, minting only if nobody has.
   *
   * The in-memory copy stays in front of this deliberately - it keeps a Redis
   * round trip off the hot path, and it is what the system falls back to
   * unchanged if Redis is unreachable.
   */
  private async resolveToken(): Promise<string> {
    const shared = await this.tokenRedis.getOrRefresh({
      providerName: ProviderNameEnum.MOTIONPAY,
      context: TOKEN_CONTEXT,
      refresh: () => this.mintToken(),
    });
    this.cachedToken = shared;
    return shared.token;
  }

  /** Actually call the token endpoint. The caller decides what to do with it. */
  private async mintToken(): Promise<UpstreamToken> {
    const context = 'qris token';
    const body: MotionPayTokenRequestDto = {
      client_key: this.motionPayConfig.CLIENT_KEY,
      server_key: this.motionPayConfig.SERVER_KEY,
    };

    let raw: unknown;
    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(MOTIONPAY_QRIS_ENDPOINT.TOKEN, body, {
          baseURL: this.motionPayConfig.QRIS_BASE_URL,
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
        `${context} request failed`,
        {
          status: axiosError.response?.status,
          response: axiosError.response?.data,
        },
      );
    }

    const parsed = assertUpstreamSchema<MotionPayTokenResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      context,
      MotionPayTokenResponseSchema,
      raw,
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

    // Expiry only — the token is a live credential and must never reach a log
    // line, a log file, or the log shipper.
    this.logger.log({
      msg: 'MotionPay token acquired',
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    });

    return { token, expiresAtSeconds };
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

    const exp = readJwtExpSeconds(token);
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
}
