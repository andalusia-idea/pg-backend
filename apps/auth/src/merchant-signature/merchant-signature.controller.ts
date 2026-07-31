import { Controller, UsePipes } from '@nestjs/common';
import { MerchantSignatureService } from './merchant-signature.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AjvPipe,
  AUTH_CMD,
  FilterMerchantWebhookUrlSchema,
  type FilterMerchantWebhookUrlDto,
} from '@app/microservice';

@Controller()
export class MerchantSignatureController {
  constructor(
    private readonly merchantSignatureService: MerchantSignatureService,
  ) {}

  @MessagePattern({ cmd: AUTH_CMD.MERCHANT_SIGNATURE_WEBHOOK_URL })
  @UsePipes(
    AjvPipe<FilterMerchantWebhookUrlDto>(FilterMerchantWebhookUrlSchema),
  )
  findMerchantWebhookUrl(@Payload() payload: FilterMerchantWebhookUrlDto) {
    return this.merchantSignatureService.findMerchantWebhookUrl(payload);
  }
}
