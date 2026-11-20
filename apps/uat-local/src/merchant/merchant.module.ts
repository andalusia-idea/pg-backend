import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { MerchantCredentialsService } from './merchant-credentials.service';
import { MerchantWebhookController } from './merchant-webhook.controller';
import { MerchantWebhookStore } from './merchant-webhook.store';
import { PurchaseCron } from './purchase.cron';
import { DisbursementCron } from './disbursement.cron';

/**
 * The merchant's own side of the fake.
 *
 * The webhook receiver is build-order Step 5 and both crons are Step 7.
 * `MerchantWebhookStore` is exported rather than private to the controller so a
 * spec can tell "the callback never arrived" from "the merchant was never
 * told".
 *
 * **The payout cron joined late, and the reason is worth keeping.** Step 7 asks
 * for it second, but merchant1's `TRANSFERBANK` / `DISBURSEMENT` rail resolves
 * to `JATELINDO`, and until Step 8c repointed `JATELINDO_TRANSFER_BASE_URL` at
 * the local fake, a cron on that rail would have sent unattended payout
 * requests to the provider's real dev host every few seconds. Registering it
 * here is safe only because that key now points at `localhost:3010`.
 *
 * Both crons are off at zero and ship that way; see each class for what turning
 * it on costs. The payout one additionally needs a merchant with a settled
 * `AVAILABLE` balance, which is not the default state.
 */
@Module({
  imports: [HttpModule],
  controllers: [MerchantWebhookController],
  providers: [
    MerchantWebhookStore,
    MerchantCredentialsService,
    PurchaseCron,
    DisbursementCron,
  ],
  exports: [MerchantWebhookStore],
})
export class MerchantModule {}
