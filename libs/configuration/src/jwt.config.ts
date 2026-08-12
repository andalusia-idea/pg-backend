import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_ACCESS_TOKEN_EXPIRE_SECONDS = 43_200; // 12 hours
const DEFAULT_REFRESH_TOKEN_EXPIRE_SECONDS = 86_400; // 24 hours

@Injectable()
export class JwtConfig {
  constructor(private readonly configService: ConfigService) {}

  private secondsOrDefault(key: string, fallback: number): number {
    const value = this.configService.get<string>(key);
    if (value === undefined || value === '') return fallback;

    const seconds = Number(value);
    if (!Number.isInteger(seconds) || seconds <= 0) {
      throw new Error(
        `key [${key}] value [${value}] must be a positive integer (seconds)`,
      );
    }
    return seconds;
  }

  get ACCESS_TOKEN_SECRET(): string {
    return this.configService.getOrThrow<string>('JWT_ACCESS_TOKEN_SECRET');
  }

  get ACCESS_TOKEN_EXPIRE(): number {
    return this.secondsOrDefault(
      'JWT_ACCESS_TOKEN_EXPIRE',
      DEFAULT_ACCESS_TOKEN_EXPIRE_SECONDS,
    );
  }

  get REFRESH_TOKEN_SECRET(): string {
    return this.configService.getOrThrow<string>('JWT_REFRESH_TOKEN_SECRET');
  }

  get REFRESH_TOKEN_EXPIRE(): number {
    return this.secondsOrDefault(
      'JWT_REFRESH_TOKEN_EXPIRE',
      DEFAULT_REFRESH_TOKEN_EXPIRE_SECONDS,
    );
  }
}
