import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MerchantCredentialsService } from './merchant-credentials.service';
import { MerchantWebhookController } from './merchant-webhook.controller';
import { MerchantWebhookStore } from './merchant-webhook.store';
import { PurchaseCron } from './purchase.cron';

/**
 * The merchant's own side of the fake.
 *
 * The webhook receiver is build-order Step 5 and the purchase cron is Step 7.
 * `MerchantWebhookStore` is exported rather than private to the controller so a
 * spec can tell "the callback never arrived" from "the merchant was never
 * told".
 *
 * **No payout cron yet, and not because Step 7 ends here.** Step 7 asks for the
 * disbursement cron second, but merchant1's `TRANSFERBANK` / `DISBURSEMENT`
 * rail resolves to `JATELINDO`, and `JATELINDO_TRANSFER_BASE_URL` still points
 * at the provider's real dev host. A cron on that rail would send unattended
 * payout requests to someone else's service every few seconds. It joins here
 * once Step 8c repoints that key at the local fake - see the build order.
 */
@Module({
  imports: [HttpModule],
  controllers: [MerchantWebhookController],
  providers: [MerchantWebhookStore, MerchantCredentialsService, PurchaseCron],
  exports: [MerchantWebhookStore],
})
export class MerchantModule {}
