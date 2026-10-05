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
  JatelindoTransactionStatusRequestDto,
  JatelindoTransactionStatusResponseDto,
  JatelindoTransactionStatusResponseSchema,
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
        // POST, and the spec contradicts itself here. Its Configuration block
        // for this endpoint says `Method GET`, but the Request Example directly
        // below it is `--data-urlencode 'traceNumber=081225164201'`, which curl
        // sends as a POST, and both Postman collections POST it too. A GET
        // carrying a body is self-contradictory anyway - and axios' body would
        // be at the mercy of whatever proxy sits in front of them.
        //
        // Going with the two artifacts that were presumably run against their
        // sandbox over the one table that disagrees with its own example. §9 Q3
        // asks them to confirm; if they say GET, the body has to move to the
        // query string, not just the method change back.
        method: HttpMethodEnum.POST,
        url: JATELINDO_ENDPOINT.TRANSACTION_STATUS,
        data: body,
      },
    );

    // Was validating against the *balance* schema under the *balance* label.
    // The two shapes have no field in common - balance requires
    // `BalanceInquiryResponse`, which a status response never carries - so this
    // method could not return successfully at all. Nothing caught it because
    // `confirmWithProvider` does not reach Jatelindo yet.
    const parsed = assertUpstreamSchema<JatelindoTransactionStatusResponseDto>(
      ProviderNameEnum.JATELINDO,
      this.transactionStatus.name,
      JatelindoTransactionStatusResponseSchema,
      raw,
    );
    this.logger.debug(parsed);

    // Returned whole on purpose. `status.responseCode` says whether the *lookup*
    // worked; the payout's own state is `TransactionStatusResponse[].
    // transactionState`, which is a different vocabulary. Do not put
    // `transactionState` through `jatelindoMapperResponseCode`.
    return parsed;
  }
}
