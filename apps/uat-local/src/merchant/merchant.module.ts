import { Module } from '@nestjs/common';
import { MerchantWebhookController } from './merchant-webhook.controller';
import { MerchantWebhookStore } from './merchant-webhook.store';

/**
 * The merchant's own side of the fake.
 *
 * Just the webhook receiver so far - build-order Step 5. The purchase and
 * payout crons are Step 7 and join this module; they will want
 * `MerchantWebhookStore` too, to tell "the callback never arrived" from "the
 * merchant was never told", which is why it is exported rather than private
 * to the controller.
 */
@Module({
  controllers: [MerchantWebhookController],
  providers: [MerchantWebhookStore],
  exports: [MerchantWebhookStore],
})
export class MerchantModule {}
