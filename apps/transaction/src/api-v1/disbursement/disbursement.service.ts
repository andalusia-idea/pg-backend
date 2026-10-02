import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@transaction/prisma';
import { DisbursementCommonService } from './disbursement-common.service';
import {
  CreateTransferDataDto,
  CreateTransferRequestDto,
} from './disbursement.dto';
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionException,
} from '@app/microservice';
import { generateSystemReference } from '../transaction.helper';
import {
  METADATA_KEY,
  UpstreamException,
  UpstreamTransferRequestDto,
  UpstreamTransferAccountInquiryResponseDto,
  UpstreamTransferPaymentResponseDto,
} from '@app/upstream';
import {
  MotionPayBillerService,
  MotionPayTransferService,
} from '../../upstream/motionpay';

@Injectable()
export class DisbursementService {
  private readonly logger = new Logger(DisbursementService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,

    private readonly common: DisbursementCommonService,
    private readonly motionPayTransferService: MotionPayTransferService,
    private readonly motionPayBillerService: MotionPayBillerService,
  ) {}

  async createTransfer(
    userId: number,
    dto: CreateTransferRequestDto,
  ): Promise<CreateTransferDataDto | null> {
    const paymentMethodName = this.common.decidePaymentMethodName(dto.bankCode);
    const providerName = await this.common.resolveProvider(
      userId,
      paymentMethodName,
    );

    const maxLength = this.common.systemReferenceMaxLength(
      providerName,
      paymentMethodName,
    );

    const systemReference = generateSystemReference({
      userId,
      transactionType: this.common.transactionType,
      paymentMethodName,
      providerName,
      maxLength,
    });

    const disbursementId = await this.common.reserveTransaction({
      userId,
      systemReference,
      providerName,
      paymentMethodName,
      dto,
    });
    const transferRequest: UpstreamTransferRequestDto = {
      systemReference,
      merchantReference: dto.merchantReference,
      providerName,
      amount: dto.amount,
      accountHolderName: dto.accountHolderName ?? null,
      accountNumber: dto.accountNumber,
      bankCode: dto.bankCode,
      note: dto.note ?? dto.merchantReference,
      providerReference: null,
    };
    const beneficiary = await this.accountInquiry(
      disbursementId,
      paymentMethodName,
      transferRequest,
    );
    transferRequest.accountHolderName = beneficiary.accountHolderName;
    transferRequest.accountNumber = beneficiary.accountNumber;
    transferRequest.providerReference = beneficiary.providerReference;

    // The reserve wrote the merchant's unverified values; this replaces them
    // with the provider's. Before the payment leg, so a payout that then fails
    // still carries the beneficiary it was actually checked against - every
    // failure path there marks the row FAILED and throws, which would skip a
    // post-payment update entirely.
    await this.common.recordBeneficiary(disbursementId, {
      accountHolderName: beneficiary.accountHolderName,
      accountNumber: beneficiary.accountNumber,
      bankCode: transferRequest.bankCode,
    });

    // const payment = await this

    return null;
  }

  private async accountInquiry(
    disbursementId: number,
    paymentMethodName: PaymentMethodNameEnum,
    request: UpstreamTransferRequestDto,
  ): Promise<UpstreamTransferAccountInquiryResponseDto> {
    let inquiry: UpstreamTransferAccountInquiryResponseDto | null = null;
    try {
      if (ProviderNameEnum.MOTIONPAY === request.providerName) {
        if (PaymentMethodNameEnum.TRANSFERBANK === paymentMethodName)
          inquiry = await this.motionPayTransferService.accountInquiry(request);
        else if (PaymentMethodNameEnum.TRANSFEREWALLET === paymentMethodName)
          inquiry = await this.motionPayBillerService.inquiry(request);
      }

      if (inquiry === null) {
        this.logger.error({
          msg: 'No transfer client for routed provider',
          providerName: request.providerName,
          paymentMethodName,
          systemReference: request.systemReference,
        });
        throw TransactionException.internalError();
      }

      if (!inquiry.valid) {
        this.logger.debug({
          msg: 'Beneficiary account did not resolve',
          systemReference: request.systemReference,
          bankCode: request.bankCode,
          message: inquiry!.message,
        });
        throw TransactionException.invalidBeneficiary(
          `${request.bankCode}/${request.accountNumber}`,
        );
      }

      return inquiry;
    } catch (error) {
      const metadataKey =
        PaymentMethodNameEnum.TRANSFERBANK === paymentMethodName
          ? METADATA_KEY.TRANSFER_BANK_ACCOUNT_INQUIRY
          : METADATA_KEY.TRANSFER_EWALLET_ACCOUNT_INQUIRY;
      if (error instanceof TransactionException) {
        await this.common.markFailed(disbursementId, {
          [metadataKey]: { reason: 'no client for provider' },
        });
        throw error;
      }
      const timedOut = this.common.isTransportFailure(error);
      this.logger.error({
        msg: `${metadataKey} failed`,
        disbursementId,
        systemReference: request.systemReference,
        timedOut,
        context: error instanceof UpstreamException ? error.context : undefined,
        error,
      });

      if (timedOut) throw TransactionException.upstreamTimeout();

      await this.common.markFailed(disbursementId, {
        [metadataKey]:
          error instanceof UpstreamException
            ? { message: error.message, ...error.context }
            : { message: 'unknown upstream failure' },
      });
      throw this.common.toMerchantFailure(
        error,
        request.systemReference,
        metadataKey,
      );
    }
  }

  private async payment({
    disbursementId,
    request,
  }: {
    disbursementId: number;
    request: UpstreamTransferRequestDto;
  }): Promise<UpstreamTransferPaymentResponseDto | null> {
    try {
      if ()
    } catch (error) {

    }
    return null;
  }
}
