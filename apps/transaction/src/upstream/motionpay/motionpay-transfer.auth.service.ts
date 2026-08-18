import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { MotionPayConfig } from '@app/configuration';
import {
  assertUpstreamSchema,
  readJwtExpSeconds,
  UpstreamException,
} from '@app/upstream';
import { ProviderNameEnum } from '@app/microservice';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosRequestConfig } from 'axios';
import {
  MOTIONPAY_STATUS_CODE,
  MOTIONPAY_TRANSFER_ENDPOINT,
} from './motionpay.constant';
import {
  MotionPayTransferTokenRequestDto,
  MotionPayTransferTokenResponseDto,
  MotionPayTransferTokenResponseSchema,
} from './dto';

/** HTTP 200 on the transfer token endpoint's bare numeric `status` field. */
const TRANSFER_TOKEN_OK = 200;

interface CachedToken {
  token: string;
  expiresAtSeconds: number;
}

/**
 * Auth for MotionPay's **Transfer** product.
 *
 * A sibling of `MotionPayAuthService` rather than a reuse of it, because
 * Transfer differs on all three axes that matter:
 *
 * - **Host**: `secure.flashmobile.id`, not the `app.` host QRIS uses.
 * - **Endpoint**: `/auth/v2/access-token`, not `/priv/v1/pg/token`.
 * - **Envelope**: `status` is a bare number here; on QRIS it is an object.
 *
 * The caching strategy is the same idea as QRIS (decode the JWT's own `exp`,
 * dedupe concurrent fetches, retry once on 401) and the fiddly part of it —
 * reading the claim — is shared via `readJwtExpSeconds` in `libs/upstream`.
 */
@Injectable()
export class MotionPayTransferAuthService {
  private readonly logger = new Logger(MotionPayTransferAuthService.name);

  private cachedToken: CachedToken | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly motionPayConfig: MotionPayConfig,
  ) {}

  /**
   * Perform an authenticated Transfer request, refreshing the token once if
   * MotionPay rejects it.
   */
  async authorizedRequest<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      return await this.send<T>(config, await this.getToken());
    } catch (error) {
      if (!this.isUnauthorized(error)) throw error;

      this.logger.warn(
        'MotionPay Transfer rejected the cached token; refreshing and retrying once',
      );
      this.cachedToken = null;
      return this.send<T>(config, await this.getToken());
    }
  }

  private async send<T>(config: AxiosRequestConfig, token: string): Promise<T> {
    const request: AxiosRequestConfig = {
      baseURL: this.motionPayConfig.TRANSFER_BASE_URL,
      timeout: this.motionPayConfig.TIMEOUT_MS,
      ...config,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        // Undocumented in the header tables, but present in the parameter list
        // for status/balance and in MotionPay's own balance cURL sample. Sent
        // on every call because an ignored extra header is harmless, whereas a
        // missing required one is a 401 that is tedious to diagnose.
        'x-server-key': this.motionPayConfig.TRANSFER_SERVER_KEY,
        ...config.headers,
      },
    };

    // Routing facts only — `request` carries both the bearer token and the
    // server key in its headers and must never be logged whole.
    this.logger.debug({
      msg: 'MotionPay Transfer request',
      method: request.method,
      url: request.url,
    });

    const response = await firstValueFrom(
      this.httpService.request<T>(request),
    );
    return response.data;
  }

  private isUnauthorized(error: unknown): boolean {
    return (
      error instanceof AxiosError &&
      error.response?.status === MOTIONPAY_STATUS_CODE.UNAUTHORIZED
    );
  }

  async getToken(): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (this.cachedToken && nowSeconds < this.cachedToken.expiresAtSeconds) {
      return this.cachedToken.token;
    }

    this.inFlight ??= this.fetchToken().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async fetchToken(): Promise<string> {
    const body: MotionPayTransferTokenRequestDto = {
      client_key: this.motionPayConfig.TRANSFER_CLIENT_KEY,
      server_key: this.motionPayConfig.TRANSFER_SERVER_KEY,
    };

    let raw: unknown;
    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(
          MOTIONPAY_TRANSFER_ENDPOINT.TOKEN,
          body,
          {
            baseURL: this.motionPayConfig.TRANSFER_BASE_URL,
            timeout: this.motionPayConfig.TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
      raw = response.data;
    } catch (error) {
      // The request body is the credential pair — never include it here.
      const axiosError = error as AxiosError;
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        'transfer token request failed',
        {
          status: axiosError.response?.status,
          response: axiosError.response?.data,
        },
      );
    }

    const parsed = assertUpstreamSchema<MotionPayTransferTokenResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      MotionPayTransferTokenResponseSchema,
      raw,
      'transfer token',
    );

    if (parsed.status !== TRANSFER_TOKEN_OK || !parsed.data) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `transfer token request rejected: ${parsed.description ?? parsed.message ?? parsed.status}`,
        { status: parsed.status, description: parsed.description },
      );
    }

    const token: string = parsed.data.token;
    const expiresAtSeconds = this.resolveExpiry(token);
    this.cachedToken = { token, expiresAtSeconds };

    this.logger.log({
      msg: 'MotionPay Transfer token acquired',
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    });

    return token;
  }

  private resolveExpiry(token: string): number {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const exp = readJwtExpSeconds(token);

    if (exp === null) {
      this.logger.warn(
        'Could not read `exp` from the MotionPay Transfer token; not caching it',
      );
      return nowSeconds;
    }

    return Math.max(exp - this.motionPayConfig.TOKEN_SKEW_SECONDS, nowSeconds);
  }
}
