import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Timing rules for merchant signature verification.
 *
 * All three values default, so nothing needs adding to `.env` to boot. They
 * are read by both `apps/auth` (verification) and `apps/transaction` (the
 * guard), which is why they live here rather than as constants in either.
 */
@Injectable()
export class MerchantSignatureConfig {
  constructor(private readonly configService: ConfigService) {}

  private readInt(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    if (raw === undefined || raw === '') return fallback;

    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`key [${key}] value [${raw}] must be a positive integer`);
    }
    return value;
  }

  /**
   * How far `X-Timestamp` may sit either side of server time, in seconds.
   *
   * Applies in both directions - a merchant's clock can run fast as easily as
   * slow - so the accepted band is twice this wide in total.
   */
  get TIMESTAMP_TOLERANCE_SECONDS(): number {
    return this.readInt('MERCHANT_SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS', 300);
  }

  /**
   * How long a spent nonce is remembered, in seconds.
   *
   * **Invariant: this must be at least twice the timestamp tolerance.** A
   * request stays acceptable for the whole `±tolerance` band, so if its nonce
   * is forgotten before that band closes, the request becomes replayable in
   * the gap. Enforced below rather than left as a comment, because the two
   * values are set independently and the failure is silent.
   */
  get NONCE_TTL_SECONDS(): number {
    const ttl = this.readInt('MERCHANT_SIGNATURE_NONCE_TTL_SECONDS', 600);
    const minimum = this.TIMESTAMP_TOLERANCE_SECONDS * 2;

    if (ttl < minimum) {
      throw new Error(
        `MERCHANT_SIGNATURE_NONCE_TTL_SECONDS [${ttl}] must be at least ` +
          `2x MERCHANT_SIGNATURE_TIMESTAMP_TOLERANCE_SECONDS [${minimum}], ` +
          `otherwise a request is replayable once its nonce expires while ` +
          `its timestamp is still inside the accepted window`,
      );
    }
    return ttl;
  }

  /**
   * How long after a rotation `secretKeyPrevious` keeps being accepted, in
   * seconds. Long enough for a merchant to redeploy, short enough to bound
   * exposure of a retired key.
   */
  get SECRET_KEY_GRACE_SECONDS(): number {
    return this.readInt('MERCHANT_SIGNATURE_SECRET_KEY_GRACE_SECONDS', 86_400);
  }
}
