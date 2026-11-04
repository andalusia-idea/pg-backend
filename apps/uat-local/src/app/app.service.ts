import { AppConfig } from '@app/configuration';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  constructor(private readonly appConfig: AppConfig) {}

  app(): string {
    return `${this.appConfig.APP_NAME} [${this.appConfig.NODE_ENV}]`;
  }
}
