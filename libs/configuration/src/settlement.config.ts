import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SettlementConfig {
  constructor(private readonly configService: ConfigService) {}
  private portValidator(key: string): number {
    const value = this.configService.getOrThrow<number>(key);

    const port = Number(value);

    if (!Number.isInteger(port)) {
      throw new Error(
        `key [${key}] value [${value}] PORT must be a valid integer`,
      );
    }
    return port;
  }

  get POSTGRESQL_URL_MASTER_AUTH(): string {
    return this.configService.getOrThrow<string>('POSTGRESQL_URL_MASTER_AUTH');
  }
  get POSTGRESQL_URL_SLAVE_AUTH(): string {
    return this.configService.getOrThrow<string>('POSTGRESQL_URL_SLAVE_AUTH');
  }

  get POSTGRESQL_URL_MASTER_CONFIG(): string {
    return this.configService.getOrThrow<string>(
      'POSTGRESQL_URL_MASTER_CONFIG',
    );
  }
  get POSTGRESQL_URL_SLAVE_CONFIG(): string {
    return this.configService.getOrThrow<string>('POSTGRESQL_URL_SLAVE_CONFIG');
  }

  get POSTGRESQL_URL_MASTER_TRANSACTION(): string {
    return this.configService.getOrThrow<string>(
      'POSTGRESQL_URL_MASTER_TRANSACTION',
    );
  }

  get POSTGRESQL_URL_SLAVE_TRANSACTION(): string {
    return this.configService.getOrThrow<string>(
      'POSTGRESQL_URL_SLAVE_TRANSACTION',
    );
  }

  get REDIS_HOST(): string {
    return this.configService.getOrThrow<string>('REDIS_HOST');
  }
  get REDIS_PORT(): number {
    return this.portValidator('REDIS_PORT');
  }
  get REDIS_USERNAME(): string {
    return this.configService.getOrThrow<string>('REDIS_USERNAME');
  }
  get REDIS_PASSWORD(): string {
    return this.configService.getOrThrow<string>('REDIS_PASSWORD');
  }
}
