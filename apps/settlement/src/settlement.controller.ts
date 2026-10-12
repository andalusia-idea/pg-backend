import { Controller, Get } from '@nestjs/common';
import { SettlementService } from './settlement.service';

@Controller()
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Get()
  getHello(): string {
    return this.settlementService.getHello();
  }
}
