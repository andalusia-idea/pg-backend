import { Module } from '@nestjs/common';
import { ConfigFeeController } from './config-fee.controller';
import { ConfigFeeService } from './config-fee.service';

@Module({
  controllers: [ConfigFeeController],
  providers: [ConfigFeeService],
  exports: [ConfigFeeService],
})
export class ConfigFeeModule {}
