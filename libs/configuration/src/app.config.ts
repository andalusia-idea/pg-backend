import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from './environment.enum';

@Injectable()
export class AppConfig {
  constructor(private readonly configService: ConfigService) {}

  get APP_NAME(): string {
    return this.configService.getOrThrow<string>('APP_NAME');
  }

  get VERSION(): string {
    return this.configService.getOrThrow<string>('VERSION');
  }

  get API_PREFIX(): string {
    return `/api/${this.VERSION}`;
  }

  get PORT(): number {
    const value = this.configService.getOrThrow<string>('PORT');

    const port = Number(value);

    if (!Number.isInteger(port)) {
      throw new Error(
        `key [PORT] value [${value}] PORT must be a valid integer`,
      );
    }

    return port;
  }

  get CORS_ORIGINS(): string[] {
    const value = this.configService.getOrThrow<string>('CORS_ORIGINS');

    return value
      .split(';')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get DATABASE_URL_MASTER(): string {
    return this.configService.getOrThrow<string>('DATABASE_URL_MASTER');
  }

  get DATABASE_URL_SLAVE(): string {
    return this.configService.getOrThrow<string>('DATABASE_URL_SLAVE');
  }

  get NODE_ENV(): Environment {
    const nodeEnv = this.configService.getOrThrow<Environment>('NODE_ENV');
    if (!Object.values(Environment).includes(nodeEnv)) {
      throw new Error(
        `NODE_ENV must be one of: ${Object.values(Environment).join(', ')}`,
      );
    }
    return nodeEnv;
  }

  get TIMEZONE(): string {
    return this.configService.getOrThrow<string>('TIMEZONE');
  }

  get IS_DEVELOPMENT(): boolean {
    return this.NODE_ENV === Environment.DEVELOPMENT;
  }
  get IS_PRODUCTION(): boolean {
    return this.NODE_ENV === Environment.PRODUCTION;
  }
  get IS_TEST(): boolean {
    return this.NODE_ENV === Environment.TEST;
  }
}
