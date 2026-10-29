import { Module } from '@nestjs/common';
import { UatLocalController } from './uat-local.controller';
import { UatLocalService } from './uat-local.service';

@Module({
  imports: [],
  controllers: [UatLocalController],
  providers: [UatLocalService],
})
export class UatLocalModule {}
