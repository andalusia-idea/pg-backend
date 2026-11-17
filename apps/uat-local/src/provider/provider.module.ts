import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { CallbackDispatcher } from './callback.dispatcher';
import { MotionPayFakeController } from './motionpay/motionpay.fake.controller';
import { ProviderStore } from './provider.store';

/**
 * The outside world, as far as `apps/transaction` is concerned.
 *
 * **A leaf, and that is the test that the design was followed.** It imports
 * `HttpModule` and nothing of ours - `UatConfig` reaches the dispatcher through
 * a global provider rather than an import here. If anything in `provider/` ever
 * needs an import from `apps/transaction`, that is the signal the fake has
 * stopped being a fake.
 *
 * MotionPay QRIS only so far: the create routes are build-order Step 4 and the
 * dispatcher is Step 6. The Jatelindo transfer fake is Step 8 and joins this
 * module rather than replacing anything in it.
 */
@Module({
  imports: [HttpModule],
  controllers: [MotionPayFakeController],
  providers: [ProviderStore, CallbackDispatcher],
  exports: [ProviderStore],
})
export class ProviderModule {}
