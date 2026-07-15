import { Controller, Get } from '@nestjs/common';
import { SettlereconService } from './settlerecon.service';

@Controller()
export class SettlereconController {
  constructor(private readonly settlereconService: SettlereconService) {}

  @Get()
  getHello(): string {
    return this.settlereconService.getHello();
  }
}
