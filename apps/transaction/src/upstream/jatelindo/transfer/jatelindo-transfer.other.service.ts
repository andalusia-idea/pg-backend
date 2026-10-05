import { Injectable, Logger } from '@nestjs/common';
import { JatelindoTransferAuthService } from './jatelindo-transfer.auth.service';
import { JatelindoRequestAuthService } from '../helper/jatelindo-request-auth.service';
import { HttpMethodEnum, ProviderNameEnum } from '@app/microservice';
import {
  assertUpstreamSchema,
  UpstreamTransferStatusRequestDto,
} from '@app/upstream';
import { JATELINDO_ENDPOINT } from '../helper';
import {
  JatelindoBalanceInquiryResponseDto,
  JatelindoBalanceInquiryResponseSchema,
  JatelindoTransactionStatuResponseDto,
  JatelindoTransactionStatusRequestDto,
} from '../dto';

@Injectable()
export class JatelindoTransferOtherService {
  private readonly logger = new Logger(JatelindoTransferOtherService.name);

  constructor(
    private readonly authService: JatelindoTransferAuthService,
    private readonly requestAuth: JatelindoRequestAuthService,
  ) {}

  async balanceInquiry() {
    const requestAuth = await this.requestAuth.balanceInquiry();

    const raw = await this.authService.request(
      this.balanceInquiry.name,
      requestAuth,
      {
        method: HttpMethodEnum.POST,
        url: JATELINDO_ENDPOINT.BALANCE_INQUIRY,
      },
    );

    const parsed = assertUpstreamSchema<JatelindoBalanceInquiryResponseDto>(
      ProviderNameEnum.JATELINDO,
      this.balanceInquiry.name,
      JatelindoBalanceInquiryResponseSchema,
      raw,
    );

    this.logger.debug(parsed);
    const data = parsed.BalanceInquiryResponse;
    return data;
  }

  async transactionStatus(dto: UpstreamTransferStatusRequestDto) {
    const body: JatelindoTransactionStatusRequestDto = {
      traceNumber: dto.systemReference,
    };
    const requestAuth = await this.requestAuth.transactionStatus(body);

    const raw = await this.authService.request(
      this.transactionStatus.name,
      requestAuth,
      {
        method: HttpMethodEnum.GET,
        url: JATELINDO_ENDPOINT.TRANSACTION_STATUS,
        data: body,
      },
    );

    const parsed = assertUpstreamSchema<JatelindoTransactionStatuResponseDto>(
      ProviderNameEnum.JATELINDO,
      this.balanceInquiry.name,
      JatelindoBalanceInquiryResponseSchema,
      raw,
    );
    this.logger.debug(parsed);
    return parsed;
  }
}
