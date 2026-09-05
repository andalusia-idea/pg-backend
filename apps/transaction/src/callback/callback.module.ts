import { Module } from '@nestjs/common';
import { PurchaseModule } from '../api-v1/purchase';
import { MotionPayModule } from '../upstream/motionpay';
import { MotionPayCallbackController } from './motionpay.callback.controller';

/**
 * Inbound notifications from upstream providers.
 *
 * **This module exists to break a dependency cycle, and that is worth stating
 * plainly because the alternative looks tidier and does not work.**
 *
 * A provider callback needs two things: the adapter that understands that
 * provider's wire format, and the business service that knows what a payment
 * means. Putting the route in `MotionPayModule` makes `upstream/` depend on
 * `api-v1/` - and `api-v1/` already depends on `upstream/`, so the two modules
 * import each other and Nest cannot resolve either. `forwardRef` would silence
 * that without fixing it.
 *
 * Instead the route lives here, in a module that imports **both** and is
 * imported by neither. `upstream/` stays a leaf; `api-v1/purchase` stays
 * unaware that an HTTP callback route exists at all. Adding a second provider's
 * callback means another controller here, and no change to either side.
 *
 * These endpoints answer in plain HTTP status codes, not the SNAP envelope
 * merchants receive - MotionPay only reads the status.
 */
@Module({
  imports: [MotionPayModule, PurchaseModule],
  controllers: [MotionPayCallbackController],
})
export class CallbackModule {}
