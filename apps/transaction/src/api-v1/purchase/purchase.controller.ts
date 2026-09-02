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
  type CreateQrisRequestDto,
  CreateQrisRequestSchema,
} from './purchase.dto';
import { PurchaseService } from './purchase.service';

@Controller()
@ApiTags('Merchant API v1')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post('/open/v1/test')
  @MerchantEndpoint()
  @ApiOperation({ summary: 'Purchase Test' })
  test(@MerchantUserId() merchantUserId: number) {
    return { merchantUserId };
  }

  /**
   * Generate a dynamic QRIS.
   *
   * The handler returns the `data` payload only - `responseCode`,
   * `responseMessage` and `serverTime` are added by
   * `MerchantResponseInterceptor`. Building the envelope here as well would
   * give one endpoint two sources for the same three fields.
   *
   * `MerchantBodyPipe` rather than the shared `AjvPipe`: the shared one throws
   * `BadRequestException`, which `MerchantExceptionFilter` does not catch, so a
   * malformed body would come back in Nest's default shape while every other
   * failure on this route speaks the SNAP envelope.
   */
  @Post('v1/qr/qr-mpm-generate')
  @MerchantEndpoint()
  @MerchantSuccessCode(MERCHANT_SERVICE_CODE.PURCHASE)
  @ApiOperation({ summary: 'Generate QR MPM' })
  createQris(
    @MerchantUserId() userId: number,
    @Body(MerchantBodyPipe<CreateQrisRequestDto>(CreateQrisRequestSchema))
    body: CreateQrisRequestDto,
  ) {
    return this.purchaseService.createQRIS(userId, body);
  }
}
