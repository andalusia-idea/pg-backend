import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Cache lifetimes for fee calculation.
 *
 * Grouped by domain rather than by mechanism. A class holding "everything that
 * happens to be a TTL" reads tidily but cannot express a relationship between
 * two values, because the value a TTL is constrained by is usually not itself
 * a TTL - `MerchantSignatureConfig.NONCE_TTL_SECONDS`, for instance, has to be
 * validated against a timestamp tolerance that lives in the same class.
 *
 * These three are genuinely independent today. Keeping them here means a
 * constraint between them has somewhere to live if one ever appears.
 */
@Injectable()
export class FeeConfig {
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
   * 6 Hours
   */
  get BASE_FEE_TTL_SECONDS(): number {
    return this.readInt('BASE_FEE_TTL_SECONDS', 21600);
  }

  /**
   * 6 Hours
   */
  get MERCHANT_FEE_TTL_SECONDS(): number {
    return this.readInt('MERCHANT_FEE_TTL_SECONDS', 21600);
  }

  /**
   * 6 Hours
   */
  get AGENT_SHAREHOLDER_TTL_SECONDS(): number {
    return this.readInt('AGENT_SHAREHOLDER_TTL_SECONDS', 21600);
  }
}
