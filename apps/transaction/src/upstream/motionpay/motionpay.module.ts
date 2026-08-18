import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MotionPayAuthService } from './motionpay-auth.service';
import { MotionPayQRISService } from './motionpay-qris.service';
import { MotionPayQrisController } from './motionpay-qris.controller';
import { MotionPayTransferAuthService } from './motionpay-transfer.auth.service';
import { MotionPayTransferService } from './motionpay-transfer.service';
import { MotionPayTransferController } from './motionpay-transfer.controller';

/**
 * MotionPay (Flash Mobile) client — two independent products behind one
 * provider name:
 *
 * - **QRIS** (`MotionPayQRISService`) — pay-in, on the `app.` host.
 * - **Transfer** (`MotionPayTransferService`) — payout from a prepaid deposit,
 *   on the `secure.` host with its own credentials and token endpoint.
 *
 * Each has its own auth service because the two token endpoints return
 * differently shaped envelopes; neither is an internal detail worth exposing,
 * so only the two product services are exported.
 *
 * The controllers are manual test surfaces for Swagger, not product API — both
 * are inert in production and should be dropped once the real purchase and
 * payout flows call these services directly.
 *
 * `MotionPayConfig` is not imported here — `ConfigurationModule` is @Global and
 * is registered in the app module.
 */
@Module({
  imports: [HttpModule],
  controllers: [MotionPayQrisController, MotionPayTransferController],
  providers: [
    MotionPayAuthService,
    MotionPayQRISService,
    MotionPayTransferAuthService,
    MotionPayTransferService,
  ],
  exports: [MotionPayQRISService, MotionPayTransferService],
})
export class MotionPayModule {}
