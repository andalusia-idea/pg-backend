import { Module } from '@nestjs/common';
import { MerchantDetailController } from './merchant-detail.controller';
import { MerchantDetailService } from './merchant-detail.service';

@Module({
  controllers: [MerchantDetailController],
  providers: [MerchantDetailService],
  exports: [MerchantDetailService],
})
export class MerchantDetailModule {}
