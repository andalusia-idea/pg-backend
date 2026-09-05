import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import {
  MotionPayQrisAuthService,
  MotionPayQrisCallbackService,
  MotionPayQrisManualController,
  MotionPayQrisService,
} from './qris';
import {
  MotionPayTransferManualController,
  MotionPayTransferAuthService,
  MotionPayTransferService,
} from './transfer';

/**
 * MotionPay (Flash Mobile) client — two independent products behind one
 * provider name:
 *
 * - **QRIS** (`MotionPayQrisService`) — pay-in, on the `app.` host.
 * - **Transfer** (`MotionPayTransferService`) — payout from a prepaid deposit,
 *   on the `secure.` host with its own credentials and token endpoint.
 *
 * Each has its own auth service because the two token endpoints return
 * differently shaped envelopes; neither is an internal detail worth exposing,
 * so only the two product services are exported.
 *
 * The two controllers here are manual test surfaces for Swagger, not product
 * API — both are inert in production and should be dropped once the real
 * purchase and payout flows call these services directly.
 *
 * The inbound QRIS **callback** route is deliberately not one of them. This
 * module must not depend on the business layer, so the endpoint that composes
 * translation with settlement lives in `src/callback` and imports both. What
 * lives here is `MotionPayQrisCallbackService`, which only translates.
 *
 * `MotionPayConfig` is not imported here — `ConfigurationModule` is @Global and
 * is registered in the app module.
 */
@Module({
  imports: [HttpModule],
  controllers: [
    MotionPayQrisManualController,
    MotionPayTransferManualController,
  ],
  providers: [
    MotionPayQrisAuthService,
    MotionPayQrisService,
    MotionPayQrisCallbackService,
    MotionPayTransferAuthService,
    MotionPayTransferService,
  ],
  exports: [
    MotionPayQrisService,
    MotionPayQrisCallbackService,
    MotionPayTransferService,
  ],
})
export class MotionPayModule {}
