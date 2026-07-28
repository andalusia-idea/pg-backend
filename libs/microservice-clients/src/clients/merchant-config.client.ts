import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { CONFIG_CLIENT, CONFIG_CMD, MICROSERVICE_CALL_TIMEOUT_MS } from '../constants/tcp-clients.constant';
import { CreateMerchantDto } from '../dto/merchant-config.dto';

@Injectable()
export class MerchantConfigClient {
  constructor(
    @Inject(CONFIG_CLIENT)
    private readonly configClient: ClientProxy,
  ) {}

  create(body: CreateMerchantDto) {
    return firstValueFrom(
      this.configClient
        .send<void>({ cmd: CONFIG_CMD.CREATE_MERCHANT_CONFIG }, body)
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }
}
