import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment } from './environment.enum';

@Injectable()
export class AppConfig {
  constructor(private readonly configService: ConfigService) {}

  get APP_NAME(): string {
    return this.configService.getOrThrow<string>('APP_NAME', 'PG');
  }

  get VERSION(): string {
    return this.configService.getOrThrow<string>('VERSION', 'v1');
  }

  get API_PREFIX(): string {
    return `/api/${this.VERSION}`;
  }

  get PORT(): number {
    return this.configService.getOrThrow<number>('PORT', 3000);
  }

  get NODE_ENV(): Environment {
    return this.configService.getOrThrow<Environment>(
      'NODE_ENV',
      Environment.DEVELOPMENT,
    );
  }

  get TIMEZONE(): string {
    return this.configService.getOrThrow<string>('TIMEZONE', 'Asia/Jakarta');
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
