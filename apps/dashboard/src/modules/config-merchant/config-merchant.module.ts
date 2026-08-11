import { Module } from '@nestjs/common';
import { ConfigMerchantController } from './config-merchant.controller';
import { ConfigMerchantService } from './config-merchant.service';

@Module({
  controllers: [ConfigMerchantController],
  providers: [ConfigMerchantService],
  exports: [ConfigMerchantService],
})
export class ConfigMerchantModule {}
