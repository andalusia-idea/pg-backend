import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_TIMEOUT_MS = 15_000;
/** Renew the token this long before its JWT `exp`, to absorb clock skew and flight time. */
const DEFAULT_TOKEN_SKEW_SECONDS = 300; // 5 minutes

@Injectable()
export class MotionPayConfig {
  constructor(private readonly configService: ConfigService) {}

  private positiveIntOrDefault(key: string, fallback: number): number {
    const value = this.configService.get<string>(key);
    if (value === undefined || value === '') return fallback;

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `key [${key}] value [${value}] must be a positive integer`,
      );
    }
    return parsed;
  }

  /**
   * Base URL without a trailing slash.
   *
   * Deliberately configurable rather than hardcoded: MotionPay's own docs give
   * two different hosts (`flashmobile.id` in the OpenAPI servers block, but
   * `flashmobile.co.id` in the prose and the cURL sample). See
   * docs/upstream/motionpay.md.
   */
  get BASE_URL(): string {
    const value = this.configService.getOrThrow<string>('MOTIONPAY_BASE_URL');
    return value.replace(/\/+$/, '');
  }

  get CLIENT_KEY(): string {
    return this.configService.getOrThrow<string>('MOTIONPAY_CLIENT_KEY');
  }

  get SERVER_KEY(): string {
    return this.configService.getOrThrow<string>('MOTIONPAY_SERVER_KEY');
  }

  get TIMEOUT_MS(): number {
    return this.positiveIntOrDefault(
      'MOTIONPAY_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS,
    );
  }

  get TOKEN_SKEW_SECONDS(): number {
    return this.positiveIntOrDefault(
      'MOTIONPAY_TOKEN_SKEW_SECONDS',
      DEFAULT_TOKEN_SKEW_SECONDS,
    );
  }

  /* ------------------------------------------------------------------ *
   * Transfer service (payout)                                          *
   *                                                                    *
   * Transfer is a separate product from QRIS with its own host and its *
   * own token endpoint, so it gets its own settings rather than reusing *
   * BASE_URL above. Credentials fall back to the QRIS pair when the     *
   * transfer-specific ones are unset, since a merchant may be issued    *
   * one set for both.                                                   *
   * ------------------------------------------------------------------ */

  /**
   * Transfer base URL, no trailing slash.
   *
   * Note this is the **secure.** host, not the **app.** host QRIS uses —
   * `https://sandbox-secure.flashmobile.id` / `https://secure.flashmobile.id`.
   * MotionPay's own cURL samples for transfer contradict this and show the app
   * host; see docs/upstream/motionpay.md.
   */
  get TRANSFER_BASE_URL(): string {
    const value = this.configService.getOrThrow<string>(
      'MOTIONPAY_TRANSFER_BASE_URL',
    );
    return value.replace(/\/+$/, '');
  }

  get TRANSFER_CLIENT_KEY(): string {
    return (
      this.configService.get<string>('MOTIONPAY_TRANSFER_CLIENT_KEY') ||
      this.CLIENT_KEY
    );
  }

  get TRANSFER_SERVER_KEY(): string {
    return (
      this.configService.get<string>('MOTIONPAY_TRANSFER_SERVER_KEY') ||
      this.SERVER_KEY
    );
  }
}
