import { Injectable, Logger } from '@nestjs/common';
import { JatelindoTransferAuthService } from './jatelindo-transfer.auth.service';

import { JatelindoRequestAuthService } from '../helper/jatelindo-request-auth.service';
import {
  JatelindoInquiryRequestDto,
  JatelindoInquiryResponseDto,
  JatelindoInquiryResponseSchema,
  JatelindoSingleTransferRequestDto,
  JatelindoSingleTransferResponseDto,
  JatelindoSingleTransferResponseSchema,
} from '../dto';
import {
  JATELINDO_CHANNEL,
  JATELINDO_ENDPOINT,
  JATELINDO_RESPONSE_CODE,
  jatelindoMapperResponseCode,
} from '../helper';
import {
  assertUpstreamSchema,
  isUpstreamTransportFailure,
  METADATA_KEY,
  UpstreamTransferBeneficiary,
  UpstreamTransferException,
  UpstreamTransferRequestDto,
  UpstreamTransferResponseDto,
  UpstreamTransferStep,
} from '@app/upstream';
import {
  HttpMethodEnum,
  isEwalletEnum,
  ProviderNameEnum,
  TransactionStatusEnum,
} from '@app/microservice';

@Injectable()
export class JatelindoTransferService {
  private readonly logger = new Logger(JatelindoTransferService.name);

  constructor(
    private readonly authService: JatelindoTransferAuthService,
    private readonly requestAuth: JatelindoRequestAuthService,
  ) {}

  /**
   * Send a payout: inquiry, then single transfer, as one operation.
   *
   * **This is the entry point the business layer uses.** Same contract as the
   * MotionPay rails' `createTransfer` - one call, and an
   * `UpstreamTransferException` naming the leg on failure - so the disbursement
   * domain never learns how many round trips a provider needs.
   *
   * The sequence is written out here rather than shared with MotionPay, because
   * it is not the same sequence: Jatelindo reports both legs' outcomes as
   * response *codes* in a 200 envelope rather than by throwing, so each leg is
   * followed by a code check rather than a try/catch alone.
   */
  async createTransfer(
    params: UpstreamTransferRequestDto,
  ): Promise<UpstreamTransferResponseDto> {
    let accountInquiry: JatelindoInquiryResponseDto;
    try {
      accountInquiry = await this.accountInquiry(params);
    } catch (error) {
      // An inquiry is a read, so nothing moved - even a timeout here is safe to
      // report as a clean failure.
      throw new UpstreamTransferException({
        provider: ProviderNameEnum.JATELINDO,
        message: 'account inquiry failed',
        step: UpstreamTransferStep.INQUIRY,
        outcomeUnknown: false,
        cause: error,
        context: error instanceof Error ? { cause: error.message } : {},
      });
    }

    // Jatelindo answers 200 with a response code rather than throwing, so an
    // unresolved account arrives looking like a success. Not checking this is
    // what would send money to an account nobody confirmed exists.
    const accountInquiryStatus = jatelindoMapperResponseCode(
      accountInquiry.status.responseCode as JATELINDO_RESPONSE_CODE,
    );
    if (accountInquiryStatus !== TransactionStatusEnum.SUCCESS) {
      throw new UpstreamTransferException({
        provider: ProviderNameEnum.JATELINDO,
        message:
          accountInquiry.status.message ??
          'beneficiary account did not resolve',
        step: UpstreamTransferStep.INQUIRY,
        outcomeUnknown: false,
        context: {
          beneficiaryValid: false,
          responseCode: accountInquiry.status.responseCode,
          [METADATA_KEY.TRANSFER_ACCOUNT_INQUIRY]: accountInquiry,
        },
      });
    }

    const beneficiary: UpstreamTransferBeneficiary = {
      bankCode: params.bankCode,
      accountNumber: params.accountNumber,
      accountHolderName: accountInquiry.inquiryInfo.accountName,
    };

    let payment: JatelindoSingleTransferResponseDto;
    try {
      payment = await this.payment(params, accountInquiry);
    } catch (error) {
      // The one case where the caller must not assert anything: if the call
      // never got an answer, the money may already have left.
      throw new UpstreamTransferException({
        provider: ProviderNameEnum.JATELINDO,
        message: 'single transfer failed',
        step: UpstreamTransferStep.PAYMENT,
        outcomeUnknown: isUpstreamTransportFailure(error),
        beneficiary,
        cause: error,
        context: error instanceof Error ? { cause: error.message } : {},
      });
    }

    const paymentStatus = jatelindoMapperResponseCode(
      payment.status.responseCode as JATELINDO_RESPONSE_CODE,
    );

    // Only an outright rejection is a failure. PENDING is a normal outcome -
    // payouts settle asynchronously, with the final state arriving by callback.
    //
    // `outcomeUnknown` is false here on purpose: the provider answered, and its
    // answer was no. That is a verified failure, unlike a call that timed out.
    if (paymentStatus === TransactionStatusEnum.FAILED) {
      throw new UpstreamTransferException({
        provider: ProviderNameEnum.JATELINDO,
        message: payment.status.message ?? 'single transfer rejected',
        step: UpstreamTransferStep.PAYMENT,
        outcomeUnknown: false,
        beneficiary,
        context: {
          responseCode: payment.status.responseCode,
          [METADATA_KEY.TRANSFER_PAYMENT]: payment,
        },
      });
    }

    return {
      providerReference: payment.jpaReferenceNo,
      bankReference: payment.DisbursementResponse[0].transactionNumber,

      ...beneficiary,

      status: paymentStatus,
      nominal: params.amount,
      message: payment.status.message,
      metadata: {
        [METADATA_KEY.TRANSFER_ACCOUNT_INQUIRY]: accountInquiry,
        [METADATA_KEY.TRANSFER_PAYMENT]: payment,
      },
    };
  }

  async accountInquiry(params: UpstreamTransferRequestDto) {
    const isWallet = isEwalletEnum(params.bankCode);
    const body: JatelindoInquiryRequestDto = {
      accountNo: isWallet ? '' : params.accountNumber,
      amount: params.amount.value,
      channelId: JATELINDO_CHANNEL[params.bankCode],
      description: null,
      phoneNo: isWallet ? params.accountNumber : '',
      name: params.accountHolderName ?? '',
      email: null,
    };
    const requestPath = await this.requestAuth.inquiry(body);

    const raw = await this.authService.request(
      this.accountInquiry.name,
      requestPath,
      {
        method: HttpMethodEnum.POST,
        url: JATELINDO_ENDPOINT.INQUIRY,
        data: body,
      },
    );

    const parsed = assertUpstreamSchema<JatelindoInquiryResponseDto>(
      ProviderNameEnum.JATELINDO,
      this.accountInquiry.name,
      JatelindoInquiryResponseSchema,
      raw,
    );
    this.logger.debug(parsed);
    return parsed;
  }

  async payment(
    params: UpstreamTransferRequestDto,
    accountInquiry: JatelindoInquiryResponseDto,
  ) {
    const isWallet = isEwalletEnum(params.bankCode);
    const body: JatelindoSingleTransferRequestDto = {
      accountNo: isWallet ? '' : params.accountNumber,
      traceNumber: params.systemReference,
      amount: params.amount.value,
      channelId: JATELINDO_CHANNEL[params.bankCode],
      description: params.note,
      phoneNo: isWallet ? params.accountNumber : '',
      name: accountInquiry.inquiryInfo.accountName,
      email: null,
    };
    const requestPath = await this.requestAuth.singleTransfer(body);

    const raw = await this.authService.request(this.payment.name, requestPath, {
      method: HttpMethodEnum.POST,
      url: JATELINDO_ENDPOINT.SINGLE_TRANSFER,
      data: body,
    });
    const parsed = assertUpstreamSchema<JatelindoSingleTransferResponseDto>(
      ProviderNameEnum.JATELINDO,
      this.payment.name,
      JatelindoSingleTransferResponseSchema,
      raw,
    );
    this.logger.debug(parsed);
    return parsed;
  }
}
