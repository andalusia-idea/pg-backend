import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { CONFIG_CLIENT, CONFIG_CMD, MICROSERVICE_CALL_TIMEOUT_MS } from '../constants/tcp-clients.constant';
import { FeeCalculationResultDto } from '../dto/fee-detail.dto';
import {
  DisbursementFeeFilterDto,
  PurchaseFeeFilterDto,
  TopupFeeFilterDto,
  WithdrawFeeFilterDto,
} from '../dto/fee-calculation.dto';

@Injectable()
export class FeeCalculateConfigClient {
  constructor(
    @Inject(CONFIG_CLIENT)
    private readonly configClient: ClientProxy,
  ) {}

  private send(cmd: string, filter: unknown) {
    return firstValueFrom(
      this.configClient
        .send<FeeCalculationResultDto>({ cmd }, filter)
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }

  calculatePurchaseFee(filter: PurchaseFeeFilterDto) {
    return this.send(CONFIG_CMD.CALCULATE_FEE_PURCHASE, filter);
  }

  calculateWithdrawFee(filter: WithdrawFeeFilterDto) {
    return this.send(CONFIG_CMD.CALCULATE_FEE_WITHDRAW, filter);
  }

  calculateTopupFee(filter: TopupFeeFilterDto) {
    return this.send(CONFIG_CMD.CALCULATE_FEE_TOPUP, filter);
  }

  calculateDisbursementFee(filter: DisbursementFeeFilterDto) {
    return this.send(CONFIG_CMD.CALCULATE_FEE_DISBURSEMENT, filter);
  }
}
