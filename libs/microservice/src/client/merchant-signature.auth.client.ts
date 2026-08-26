import { Inject, Injectable } from '@nestjs/common';
import {
  AUTH_CLIENT,
  AUTH_CMD,
  MICROSERVICE_CALL_TIMEOUT_MS,
} from '../microservice.constant';
import { ClientProxy } from '@nestjs/microservices';
import {
  FilterMerchantSignatureValidationDto,
  FilterMerchantWebhookUrlDto,
  MerchantSignatureValidationDto,
  MerchantWebhookUrlDto,
} from '../dto';
import { firstValueFrom, timeout } from 'rxjs';

@Injectable()
export class MerchantSignatureAuthClient {
  constructor(
    @Inject(AUTH_CLIENT)
    private readonly authClient: ClientProxy,
  ) {}

  findMerchantWebhookUrl(payload: FilterMerchantWebhookUrlDto) {
    return firstValueFrom(
      this.authClient
        .send<MerchantWebhookUrlDto>(
          { cmd: AUTH_CMD.MERCHANT_SIGNATURE_WEBHOOK_URL },
          payload,
        )
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }
  validateSignature(payload: FilterMerchantSignatureValidationDto) {
    return firstValueFrom(
      this.authClient
        .send<MerchantSignatureValidationDto>(
          { cmd: AUTH_CMD.MERCHANT_SIGNATURE_VALIDATION },
          payload,
        )
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }
}
