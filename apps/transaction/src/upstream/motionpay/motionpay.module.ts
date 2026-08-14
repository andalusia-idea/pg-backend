import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MotionPayAuthService } from './motionpay-auth.service';
import { MotionPayService } from './motionpay.qris.service';
import { MotionPayController } from './motionpay.controller';

/**
 * MotionPay (Flash Mobile) QRIS pay-in client.
 *
 * Import this where a purchase flow needs to reach MotionPay. It exposes only
 * `MotionPayService`; the auth service is an internal detail of the client.
 *
 * `MotionPayController` is a manual test surface for Swagger, not part of the
 * product API — it is inert in production (see the controller) and should be
 * dropped once the real purchase flow calls this service directly.
 *
 * `MotionPayConfig` is not imported here — `ConfigurationModule` is @Global and
 * is registered in the app module.
 */
@Module({
  imports: [HttpModule],
  controllers: [MotionPayController],
  providers: [MotionPayAuthService, MotionPayService],
  exports: [MotionPayService],
})
export class MotionPayModule {}
