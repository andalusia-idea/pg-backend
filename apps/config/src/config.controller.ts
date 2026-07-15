import { Controller, Get } from '@nestjs/common';
import { ConfigService } from './config.service';

@Controller()
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getHello(): string {
    return this.configService.getHello();
  }
}
