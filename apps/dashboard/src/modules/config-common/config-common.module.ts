import { Module } from '@nestjs/common';
import { ConfigCommonController } from './config-common.controller';
import { ConfigCommonService } from './config-common.service';

@Module({
  controllers: [ConfigCommonController],
  providers: [ConfigCommonService],
  exports: [ConfigCommonService],
})
export class ConfigCommonModule {}
