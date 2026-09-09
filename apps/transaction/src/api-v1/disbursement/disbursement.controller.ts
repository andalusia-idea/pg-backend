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
  type CreateTransferEWalletRequestDto,
  CreateTransferEWalletRequestSchema,
  type CreateTransferRequestDto,
  CreateTransferRequestSchema,
} from './disbursement.dto';
import { DisbursementBankService } from './disbursement-bank.service';
import { DisbursementEWalletService } from './disbursement-ewallet.service';

@Controller()
@ApiTags('Merchant API v1')
export class DisbursementController {
  constructor(
    private readonly bankService: DisbursementBankService,
    private readonly eWalletService: DisbursementEWalletService,
  ) {}

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
    return this.bankService.createTransfer(userId, body);
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
      MerchantBodyPipe<CreateTransferEWalletRequestDto>(
        CreateTransferEWalletRequestSchema,
      ),
    )
    body: CreateTransferEWalletRequestDto,
  ) {
    return this.eWalletService.createTransfer(userId, body);
  }
}
