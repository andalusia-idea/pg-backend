import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MotionPayModule } from '../../upstream/motionpay';
import { DisbursementController } from './disbursement.controller';
import { DisbursementService } from './disbursement.service';
import { DisbursementWebhookService } from './disbursement.webhook.service';

/**
 * `DisbursementWebhookService` is exported so `CallbackModule` can compose it
 * with MotionPay's translation layer. This module deliberately does not know
 * that an inbound callback route exists - see `src/callback`.
 */
@Module({
  imports: [MotionPayModule, HttpModule],
  controllers: [DisbursementController],
  providers: [DisbursementService, DisbursementWebhookService],
  exports: [DisbursementWebhookService],
})
export class DisbursementModule {}
