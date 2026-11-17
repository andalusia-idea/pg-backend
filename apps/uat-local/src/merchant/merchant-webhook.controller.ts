import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import {
  MerchantWebhookStore,
  WEBHOOK_KIND,
  WebhookKind,
} from './merchant-webhook.store';

/**
 * Where our own payin and payout notifications land - the merchant's side of
 * the fake, at the URLs inject step 07 registers on every merchant.
 *
 * ## Nothing is verified here, and that is not laziness
 *
 * `PurchaseWebhookService.notifyMerchant` posts the body with **no signature
 * headers at all** - it is a plain `httpService.post(payinUrl, body)`. So
 * there is nothing for a receiver to check, and a receiver that pretended to
 * check something would be testing a mechanism this system does not have. The
 * body is accepted as it arrives, unvalidated and untyped, which also means a
 * payload that drifts from what we document still gets recorded rather than
 * rejected - the drift is the finding.
 *
 * ## Built before the dispatcher, deliberately
 *
 * Step 6 ends in `settle()`, whose last act is `notifyMerchant`, and that call
 * is deliberately non-fatal: a missing receiver produces one error log reading
 * *"transaction IS settled, merchant was not notified"* and nothing else. That
 * is indistinguishable from a real delivery failure. With the receiver already
 * standing, the absence of that line means something.
 *
 * ## 200, not Nest's 201
 *
 * A real merchant endpoint answers 200. `notifyMerchant` only cares that the
 * request did not throw, so either would pass - which is precisely why it is
 * worth getting right here rather than discovering later that nothing ever
 * checked.
 */
@Controller('merchant/webhook')
export class MerchantWebhookController {
  private readonly logger = new Logger(MerchantWebhookController.name);

  constructor(private readonly store: MerchantWebhookStore) {}

  @Post('payin')
  @HttpCode(HttpStatus.OK)
  payin(@Body() body: unknown) {
    return this.receive(WEBHOOK_KIND.PAYIN, body);
  }

  @Post('payout')
  @HttpCode(HttpStatus.OK)
  payout(@Body() body: unknown) {
    return this.receive(WEBHOOK_KIND.PAYOUT, body);
  }

  /**
   * Read the receipts back.
   *
   * Exists so a sighting can be asserted instead of eyeballed. Not part of any
   * merchant contract - a real merchant has no such route, and nothing in
   * `apps/transaction` knows this is here.
   */
  @Get('received')
  received(
    @Query('merchantReference') merchantReference?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit);

    return {
      counts: {
        payin: this.store.countOf(WEBHOOK_KIND.PAYIN),
        payout: this.store.countOf(WEBHOOK_KIND.PAYOUT),
      },
      receipts: merchantReference
        ? this.store.byMerchantReference(merchantReference)
        : this.store.recent(
            Number.isFinite(parsedLimit) && parsedLimit > 0
              ? parsedLimit
              : undefined,
          ),
    };
  }

  private receive(kind: WebhookKind, body: unknown) {
    const receipt = this.store.record(kind, body);

    // The sighting itself: this line in the uat-local window is what Step 5
    // proves. `count` is included so a duplicate delivery is visible as the
    // second line about one reference rather than as two identical lines.
    this.logger.log({
      msg: `Merchant ${kind.toLowerCase()} webhook received`,
      transactionId: receipt.transactionId,
      merchantReference: receipt.merchantReference,
      status: receipt.status,
      count: this.store.countOf(kind),
    });

    // A merchant's acknowledgement, not an envelope of ours - this app serves
    // no `ResponseDto` interceptor and the sender reads nothing but the status.
    return { received: true };
  }
}
