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
  createTransfer(
    @MerchantUserId() userId: number,
    @Body(
      MerchantBodyPipe<CreateTransferRequestDto>(CreateTransferRequestSchema),
    )
    body: CreateTransferRequestDto,
  ) {
    return this.disbursementService.createTransfer(userId, body);
  }
}
