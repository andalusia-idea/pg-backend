import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface TCP {
  NAME: string;
  HOST: string;
  PORT: number;
}

@Injectable()
export class TCPConfig {
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

  get AUTH(): TCP {
    return {
      NAME: this.configService.getOrThrow<string>('CLIENT_AUTH_NAME'),
      HOST: this.configService.getOrThrow<string>('CLIENT_AUTH_HOST'),
      PORT: this.portValidator('CLIENT_AUTH_PORT'),
    };
  }

  get CONFIG(): TCP {
    return {
      NAME: this.configService.getOrThrow<string>('CLIENT_CONFIG_NAME'),
      HOST: this.configService.getOrThrow<string>('CLIENT_CONFIG_HOST'),
      PORT: this.portValidator('CLIENT_CONFIG_PORT'),
    };
  }

  get TRANSACTION(): TCP {
    return {
      NAME: this.configService.getOrThrow<string>('CLIENT_TRANSACTION_NAME'),
      HOST: this.configService.getOrThrow<string>('CLIENT_TRANSACTION_HOST'),
      PORT: this.portValidator('CLIENT_TRANSACTION_PORT'),
    };
  }

  get SETTLERECON(): TCP {
    return {
      NAME: this.configService.getOrThrow<string>('CLIENT_SETTLERECON_NAME'),
      HOST: this.configService.getOrThrow<string>('CLIENT_SETTLERECON_HOST'),
      PORT: this.portValidator('CLIENT_SETTLERECON_PORT'),
    };
  }
}
