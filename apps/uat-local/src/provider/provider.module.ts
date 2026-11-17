import { Module } from '@nestjs/common';
import { MotionPayFakeController } from './motionpay/motionpay.fake.controller';
import { ProviderStore } from './provider.store';

/**
 * The outside world, as far as `apps/transaction` is concerned.
 *
 * Only MotionPay QRIS so far - build-order Step 4. The Jatelindo transfer fake
 * is Step 8 and the callback dispatcher is Step 6; both join this module
 * rather than replacing anything in it, and the dispatcher is why `ProviderStore`
 * is a provider here instead of living inside the controller.
 */
@Module({
  controllers: [MotionPayFakeController],
  providers: [ProviderStore],
  exports: [ProviderStore],
})
export class ProviderModule {}
