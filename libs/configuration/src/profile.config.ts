import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProfileConfig {
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
  get PROFILE_PROVIDER_TTL_SECONDS(): number {
    return this.readInt('PROFILE_PROVIDER_TTL_SECONDS', 21600);
  }

  /**
   * 6 Hours
   */
  get PROFILE_BANK_TTL_SECONDS(): number {
    return this.readInt('PROFILE_BANK_TTL_SECONDS', 21600);
  }
}
