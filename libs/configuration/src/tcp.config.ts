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

  get AUTH(): TCP {
    return {
      NAME: this.configService.getOrThrow<string>(
        'CLIENT_AUTH_NAME',
        'PG_SERVICES',
      ),
      HOST: this.configService.getOrThrow<string>(
        'CLIENT_AUTH_HOST',
        '127.0.0.1',
      ),
      PORT: this.configService.getOrThrow<number>('CLIENT_AUTH_PORT', 4000),
    };
  }

  get CONFIG(): TCP {
    return {
      NAME: this.configService.getOrThrow<string>(
        'CLIENT_CONFIG_NAME',
        'PG_SERVICES',
      ),
      HOST: this.configService.getOrThrow<string>(
        'CLIENT_CONFIG_HOST',
        '127.0.0.1',
      ),
      PORT: this.configService.getOrThrow<number>('CLIENT_CONFIG_PORT', 4000),
    };
  }

  get TRANSACTION(): TCP {
    return {
      NAME: this.configService.getOrThrow<string>(
        'CLIENT_TRANSACTION_NAME',
        'PG_SERVICES',
      ),
      HOST: this.configService.getOrThrow<string>(
        'CLIENT_TRANSACTION_HOST',
        '127.0.0.1',
      ),
      PORT: this.configService.getOrThrow<number>(
        'CLIENT_TRANSACTION_PORT',
        4000,
      ),
    };
  }

  get SETTLERECON(): TCP {
    return {
      NAME: this.configService.getOrThrow<string>(
        'CLIENT_SETTLERECON_NAME',
        'PG_SERVICES',
      ),
      HOST: this.configService.getOrThrow<string>(
        'CLIENT_SETTLERECON_HOST',
        '127.0.0.1',
      ),
      PORT: this.configService.getOrThrow<number>(
        'CLIENT_SETTLERECON_PORT',
        4000,
      ),
    };
  }
}
