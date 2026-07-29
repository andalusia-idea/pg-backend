import { Inject, Injectable } from '@nestjs/common';
import {
  CONFIG_CLIENT,
  CONFIG_CMD,
  MICROSERVICE_CALL_TIMEOUT_MS,
} from '../microservice.constant';
import { ClientProxy } from '@nestjs/microservices';
import {
  FeeCalculationResultDto,
  FilterDisbursementFeeDto,
  FilterPurchaseFeeDto,
} from '../dto';
import { firstValueFrom, timeout } from 'rxjs';

@Injectable()
export class FeeCalculateConfigClient {
  constructor(
    @Inject(CONFIG_CLIENT)
    private readonly configClient: ClientProxy,
  ) {}

  purchase(payload: FilterPurchaseFeeDto) {
    return firstValueFrom(
      this.configClient
        .send<FeeCalculationResultDto>(
          {
            cmd: CONFIG_CMD.CALCULATE_FEE_PURCHASE,
          },
          payload,
        )
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }
  disbursement(payload: FilterDisbursementFeeDto) {
    return firstValueFrom(
      this.configClient
        .send<FeeCalculationResultDto>(
          {
            cmd: CONFIG_CMD.CALCULATE_FEE_DISBURSEMENT,
          },
          payload,
        )
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }
}
