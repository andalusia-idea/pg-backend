import { BalanceModule } from '@app/balance';
import { Module } from '@nestjs/common';
import { RunnerService } from './runner.service';
import { SettlementService } from './settlement.service';

@Module({
  // BalanceModule provides BalanceService, the only thing allowed to write
  // BalanceEntry/BalanceSnapshot. Settlement is one of its callers.
  imports: [BalanceModule],
  providers: [SettlementService, RunnerService],
  exports: [SettlementService],
})
export class SettlementModule {}
