import { AppConfig } from '@app/configuration';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  constructor(private readonly appConfig: AppConfig) {}

  app(): string {
    this.logger.log(this.appConfig.APP_NAME);
    return `${this.appConfig.APP_NAME} [${this.appConfig.NODE_ENV}]`;
  }
}
