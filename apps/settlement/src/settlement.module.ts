import { Module } from '@nestjs/common';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

@Module({
  imports: [],
  controllers: [SettlementController],
  providers: [SettlementService],
})
export class SettlementModule {}
