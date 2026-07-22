import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DatabaseConfig {
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

  get POSTGRESQL_URL_MASTER(): string {
    return this.configService.getOrThrow<string>('POSTGRESQL_URL_MASTER');
  }

  get POSTGRESQL_URL_SLAVE(): string {
    return this.configService.getOrThrow<string>('POSTGRESQL_URL_SLAVE');
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
