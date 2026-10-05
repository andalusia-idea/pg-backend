import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JatelindoConfig {
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

  get TIMEOUT_MS(): number {
    return this.positiveIntOrDefault('JATELINDO_TIMEOUT_MS', 15_000);
  }

  get TOKEN_SKEW_SECONDS(): number {
    return this.positiveIntOrDefault('JATELINDO_TOKEN_SKEW_SECONDS', 300);
  }

  get TRANSFER_BASE_URL(): string {
    return this.configService.getOrThrow<string>('JATELINDO_TRANSFER_BASE_URL');
  }

  get TRANSFER_USERNAME(): string {
    return this.configService.getOrThrow<string>('JATELINDO_TRANSFER_USERNAME');
  }
  get TRANSFER_PASSWORD(): string {
    return this.configService.getOrThrow<string>('JATELINDO_TRANSFER_PASSWORD');
  }
  get TRANSFER_API_KEY(): string {
    return this.configService.getOrThrow<string>('JATELINDO_TRANSFER_API_KEY');
  }
  get TRANSFER_SECRET(): string {
    return this.configService.getOrThrow<string>('JATELINDO_TRANSFER_SECRET');
  }
}
