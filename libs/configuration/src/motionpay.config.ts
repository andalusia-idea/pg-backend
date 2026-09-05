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

  /**
   * Source addresses permitted to POST the QRIS payment callback.
   *
   * **This is the only real authentication the callback has.** MotionPay
   * publishes no callback signature - the v2.7 spec says so outright and
   * suggests merchants "validate the received transaction_id against their
   * internal database" instead, which is not a security control: a
   * `transaction_id` is not secret, and anyone who learns one could POST a
   * forged SUCCESS. Since a SUCCESS credits a merchant balance, that is a
   * direct route to taking money.
   *
   * Defence therefore rests on two things: this allowlist, and never trusting
   * the callback body (the handler re-reads the authoritative state with its
   * own authenticated Get Payment Status call).
   *
   * Comma-separated addresses or CIDR ranges. **Empty means unrestricted**,
   * which is only acceptable until Flash tell us their egress ranges - ask
   * them, and set this before production.
   */
  /**
   * `terminal_id` sent on every Create QR Payment.
   *
   * Per QRIS Service v2.7 this identifies a **terminal or merchant**, not a
   * transaction: either the Flash merchant id (their sample: `00022654`) or a
   * point-of-sale identifier (`KASIR001`). It is embedded in the QR payload
   * itself - a probe on 2026-09-02 returned `...0708KASIR001...` inside
   * `qr_string` - so putting a per-transaction value here writes a different
   * "terminal" into every QR and makes MotionPay's terminal-level reporting
   * meaningless.
   *
   * Max 21 characters. Defaults to the aggregator-level identifier; when Flash
   * support per-sub-merchant terminals this becomes a per-merchant lookup
   * rather than one constant.
   */
  get MERCHANT_ID(): string {
    const value =
      this.configService.get<string>('MOTIONPAY_MERCHANT_ID')?.trim() ?? '';
    if (value.length === 0) {
      throw new Error(
        'MOTIONPAY_MERCHANT_ID is not set. It is a required field on Create QR ' +
          'Payment and is embedded in the QR shown to customers.',
      );
    }
    if (value.length > 21) {
      throw new Error(
        `MOTIONPAY_MERCHANT_ID [${value}] exceeds the documented 21-character limit`,
      );
    }
    return value;
  }

  get CALLBACK_ALLOWED_IPS(): string[] {
    const raw =
      this.configService.get<string>('MOTIONPAY_CALLBACK_ALLOWED_IPS') ?? '';
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
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
