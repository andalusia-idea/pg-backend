import { MERCHANT_SERVICE_CODE } from '@app/microservice';
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  MerchantBodyPipe,
  MerchantEndpoint,
  MerchantSuccessCode,
  MerchantUserId,
} from '../signature';
import {
  type CreateTransferRequestDto,
  CreateTransferRequestSchema,
} from './disbursement.dto';
import { DisbursementService } from './disbursement.service';

/**
 * Both endpoints below now resolve to the same service call: `bankCode` decides
 * the rail, so there is nothing left for the handlers to decide between them.
 *
 * **They stay two paths anyway.** Collapsing them would remove a URL merchants
 * have already integrated against, which is a contract change rather than a
 * refactor. Whether `/v1/transfer/ewallet` is worth deprecating is a product
 * decision, and until it is made, keeping both costs two identical handlers.
 */
@Controller()
@ApiTags('Merchant API v1')
export class DisbursementController {
  constructor(private readonly disbursementService: DisbursementService) {}

  /**
   * Send a bank payout.
   *
   * A 200 here means **accepted**, not paid. Payouts settle asynchronously, so
   * `data.status` is normally `PENDING` and the final state arrives on the
   * merchant's registered `payoutUrl`.
   */
  @Post('v1/transfer/bank')
  @MerchantEndpoint()
  @MerchantSuccessCode(MERCHANT_SERVICE_CODE.DISBURSEMENT)
  @ApiOperation({ summary: 'Bank transfer payout' })
  createTransferBank(
    @MerchantUserId() userId: number,
    @Body(
      MerchantBodyPipe<CreateTransferRequestDto>(CreateTransferRequestSchema),
    )
    body: CreateTransferRequestDto,
  ) {
    return this.disbursementService.createTransfer(userId, body);
  }

  /**
   * Top up an e-wallet.
   *
   * Separate from the bank endpoint because the addressing differs - wallet plus
   * phone number rather than bank code plus account number - not because the
   * money takes a different road. **Which upstream rail carries it is our
   * decision, not the merchant's**: providers reach wallets through both their
   * transfer and their bill-payment APIs at different prices, and exposing that
   * choice would mean we could not switch to a cheaper one without a
   * merchant-side change.
   *
   * As with the bank endpoint, a 200 means accepted, not paid.
   */
  @Post('v1/transfer/ewallet')
  @MerchantEndpoint()
  @MerchantSuccessCode(MERCHANT_SERVICE_CODE.DISBURSEMENT)
  @ApiOperation({ summary: 'E-wallet payout' })
  createTransferEWallet(
    @MerchantUserId() userId: number,
    @Body(
      MerchantBodyPipe<CreateTransferRequestDto>(CreateTransferRequestSchema),
    )
    body: CreateTransferRequestDto,
  ) {
    return this.disbursementService.createTransfer(userId, body);
  }
}
