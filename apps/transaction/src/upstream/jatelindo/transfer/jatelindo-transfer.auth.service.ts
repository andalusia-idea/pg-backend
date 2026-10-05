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
import { createHash } from 'crypto';

const TOKEN_CONTEXT = TokenContext.TRANSFER;

@Injectable()
export class JatelindoTransferAuthService {
  private readonly logger = new Logger(JatelindoTransferAuthService.name);

  private cachedToken: UpstreamToken | null = null;
  private inFlight: Promise<string> | null = null;
  private secretHash: string = '';

  constructor(
    private readonly httpService: HttpService,
    private readonly jatelindoConfig: JatelindoConfig,
    private readonly tokenRedis: TokenRedis,
  ) {
    this.secretHash = createHash('md5')
      .update(this.jatelindoConfig.TRANSFER_SECRET)
      .digest('hex');
    console.log(this.secretHash);
  }

  async request(
    context: string,
    requestAuth: string,
    config: { method: HttpMethodEnum; url: string; data?: unknown },
  ): Promise<unknown> {
    try {
      return await this.authorizedRequest<unknown>(config, requestAuth);
    } catch (error) {
      if (error instanceof UpstreamException) throw error;

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
      if (!this.isUnathorized(error)) throw error;

      this.logger.warn(
        'Jatelindu rejected the token; checking for a sibling refresh before minting',
      );
      this.cachedToken = null;

      const replacement = await this.tokenRedis.refreshIfUnchanged({
        providerName: ProviderNameEnum.JATELINDO,
        context: TOKEN_CONTEXT,
        staleToken: token,
        refresh: () => this.mintToken(),
      });
      this.cachedToken = replacement;

      return this.send<T>(config, replacement.token, requestAuth);
    }
  }

  private async send<T>(
    config: AxiosRequestConfig,
    token: string,
    requestAuth: string,
  ): Promise<T> {
    const configRequest: AxiosRequestConfig = {
      baseURL: this.jatelindoConfig.TRANSFER_BASE_URL,
      timeout: this.jatelindoConfig.TIMEOUT_MS,
      ...config,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
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
    return response.data;
  }

  private isUnathorized(error: unknown): boolean {
    return (
      error instanceof AxiosError &&
      error.response?.data['responseCode'] ===
        JATELINDO_RESPONSE_CODE.UNAUTHORIZED_ACCESS
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
    this.logger.log('MintToken');
    const context = 'transfer token';
    const basicAuthRaw =
      this.jatelindoConfig.TRANSFER_USERNAME +
      ':' +
      this.jatelindoConfig.TRANSFER_PASSWORD;
    // const basicAuthRaw = '1112143:123456';
    // // MTExMjE0MzoxMjM0NTY=
    // // MTExMjE0MzoxMjM0NTY=
    const basicAuth = Buffer.from(basicAuthRaw).toString('base64');
    this.logger.log(basicAuthRaw);
    this.logger.log(basicAuth);
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
      this.logger.log(response);
      this.logger.log(raw);
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.log(error);
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

    this.logger.log({
      token: token,
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
