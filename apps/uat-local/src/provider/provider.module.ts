import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { CallbackDispatcher } from './callback.dispatcher';
import { JatelindoFakeController } from './jatelindo/jatelindo.fake.controller';
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
 * **Two providers, one store, one dispatcher.** MotionPay carries QRIS pay-ins
 * (build-order Step 4) and Jatelindo carries bank and e-wallet payouts (Step
 * 8); the dispatcher is Step 6 and delivers for both. The store keeps its state
 * in neutral terms precisely so one of it can serve two providers whose status
 * vocabularies share nothing - `OUTCOME.SUCCESS` becomes MotionPay's
 * `status: 'SUCCESS'` or Jatelindo's `A00` in the payload builders, and nowhere
 * else.
 *
 * The two fakes share no helper of their own, which is deliberate: they imitate
 * unrelated providers, and a helper they both reach for is the beginning of a
 * harness where changing one silently changes the other.
 */
@Module({
  imports: [HttpModule],
  controllers: [MotionPayFakeController, JatelindoFakeController],
  providers: [ProviderStore, CallbackDispatcher],
  exports: [ProviderStore],
})
export class ProviderModule {}
