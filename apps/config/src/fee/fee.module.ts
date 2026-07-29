import { Module } from '@nestjs/common';
import { FeeController } from './fee.controller';
import { PurchaseFeeService } from './purchase-fee.service';
import { DisbursementFeeService } from './disbursement-fee.service';

@Module({
  controllers: [FeeController],
  providers: [PurchaseFeeService, DisbursementFeeService],
  exports: [PurchaseFeeService, DisbursementFeeService],
})
export class FeeModule {}
