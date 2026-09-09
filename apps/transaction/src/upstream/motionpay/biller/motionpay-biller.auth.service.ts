import { MotionPayConfig } from '@app/configuration';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { AxiosError, AxiosRequestConfig } from 'axios';
import { firstValueFrom } from 'rxjs';
import { MOTIONPAY_BILLER_ENDPOINT, MOTIONPAY_STATUS_CODE } from '../helper';
import {
  assertUpstreamSchema,
  readJwtExpSeconds,
  UpstreamException,
} from '@app/upstream';
import { ProviderNameEnum } from '@app/microservice';
import {
  MotionPayBillerTokenRequestDto,
  MotionPayBillerTokenResponseDto,
  MotionPayBillerTokenResponseSchema,
} from '../dto';

const BILLER_TOKEN_OK = 200;

interface CachedToken {
  token: string;
  /** Epoch seconds after which the token must not be reused. */
  expiresAtSeconds: number;
}

@Injectable()
export class MotionPayBillerAuthService {
  private readonly logger = new Logger(MotionPayBillerAuthService.name);

  private cachedToken: CachedToken | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly httpService: HttpService,
    private readonly motionPayConfig: MotionPayConfig,
  ) {}

  async authorizedRequest<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      return await this.send<T>(config, await this.getToken());
    } catch (error) {
      if (!this.isUnauthorized(error)) throw error;

      this.logger.warn(
        'MotionPay Biller rejected the cached token; refreshing and retrying once',
      );
      this.cachedToken = null;
      return this.send<T>(config, await this.getToken());
    }
  }

  private async send<T>(config: AxiosRequestConfig, token: string): Promise<T> {
    const request: AxiosRequestConfig = {
      baseURL: this.motionPayConfig.BILLER_BASE_URL,
      timeout: this.motionPayConfig.TIMEOUT_MS,
      ...config,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...config.headers,
      },
    };

    this.logger.debug({
      msg: 'MotionPay Biller request',
      method: request.method,
      url: request.url,
    });

    const response = await firstValueFrom(this.httpService.request<T>(request));
    return response.data;
  }

  private isUnauthorized(error: unknown): boolean {
    return (
      error instanceof AxiosError &&
      error.response?.status === MOTIONPAY_STATUS_CODE.UNAUTHORIZED
    );
  }

  private async getToken(): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (this.cachedToken && nowSeconds < this.cachedToken.expiresAtSeconds)
      return this.cachedToken.token;

    this.inFlight ??= this.fetchToken().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async fetchToken(): Promise<string> {
    const context = 'biller token';
    const body: MotionPayBillerTokenRequestDto = {
      client_key: this.motionPayConfig.CLIENT_KEY,
      server_key: this.motionPayConfig.SERVER_KEY,
    };

    let raw: unknown;
    try {
      const response = await firstValueFrom(
        this.httpService.post<unknown>(MOTIONPAY_BILLER_ENDPOINT.TOKEN, body, {
          baseURL: this.motionPayConfig.BILLER_BASE_URL,
          timeout: this.motionPayConfig.TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      raw = response.data;
    } catch (error) {
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

    const parsed = assertUpstreamSchema<MotionPayBillerTokenResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      context,
      MotionPayBillerTokenResponseSchema,
      raw,
    );

    if (parsed.status !== BILLER_TOKEN_OK || !parsed.data) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `${context} request rejected: ${parsed.description ?? parsed.message ?? parsed.status}`,
        { status: parsed.status, description: parsed.description },
      );
    }

    const token: string = parsed.data.token;
    const expiresAtSeconds = this.resolveExpiry(token);
    this.cachedToken = { token, expiresAtSeconds };

    this.logger.log({
      msg: 'MotionPay Biller token acquired',
      expiresA: new Date(expiresAtSeconds * 1000).toISOString(),
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
