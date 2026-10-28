import { Module } from '@nestjs/common';
import { BalanceVerificationService } from './balance-verification.service';

@Module({
  providers: [BalanceVerificationService],
  exports: [BalanceVerificationService],
})
export class BalanceVerificationModule {}
