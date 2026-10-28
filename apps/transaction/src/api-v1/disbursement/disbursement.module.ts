import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DisbursementController } from './disbursement.controller';
import { DisbursementService } from './disbursement.service';
import { DisbursementCommonService } from './disbursement-common.service';
import { DisbursementWebhookService } from './disbursement.webhook.service';
import { UpstreamModule } from '../../upstream/upstream.module';

/**
 * `DisbursementWebhookService` is exported so `CallbackModule` can compose it
 * with MotionPay's translation layer. This module deliberately does not know
 * that an inbound callback route exists - see `src/callback`.
 */
@Module({
  imports: [HttpModule, UpstreamModule],
  controllers: [DisbursementController],
  providers: [
    DisbursementService,
    DisbursementCommonService,
    DisbursementWebhookService,
  ],
  exports: [DisbursementWebhookService],
})
export class DisbursementModule {}
