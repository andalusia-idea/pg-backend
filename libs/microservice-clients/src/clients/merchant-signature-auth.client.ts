import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { AUTH_CLIENT, AUTH_CMD, MICROSERVICE_CALL_TIMEOUT_MS } from '../constants/tcp-clients.constant';
import {
  FindMerchantUrlDto,
  FindSignatureValidationDto,
  MerchantUrlResultDto,
  SignatureValidationResultDto,
} from '../dto/merchant-signature.dto';

@Injectable()
export class MerchantSignatureAuthClient {
  constructor(
    @Inject(AUTH_CLIENT)
    private readonly authClient: ClientProxy,
  ) {}

  signatureValidation(filter: FindSignatureValidationDto) {
    return firstValueFrom(
      this.authClient
        .send<SignatureValidationResultDto>(
          { cmd: AUTH_CMD.MERCHANT_SIGNATURE_VALIDATION },
          filter,
        )
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }

  findMerchantUrl(filter: FindMerchantUrlDto) {
    return firstValueFrom(
      this.authClient
        .send<MerchantUrlResultDto>(
          { cmd: AUTH_CMD.MERCHANT_SIGNATURE_URL },
          filter,
        )
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }
}
