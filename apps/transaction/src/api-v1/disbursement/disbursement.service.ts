import {
  paymentMethodByBankCode,
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionException,
} from '@app/microservice';
import {
  METADATA_KEY,
  UpstreamTransferException,
  UpstreamTransferRequestDto,
  UpstreamTransferResponseDto,
  UpstreamTransferStep,
} from '@app/upstream';
import { Injectable, Logger } from '@nestjs/common';
import { JatelindoTransferService } from '../../upstream/jatelindo';
import {
  MotionPayBillerService,
  MotionPayTransferService,
} from '../../upstream/motionpay';
import { generateSystemReference } from '../transaction.helper';
import { DisbursementCommonService } from './disbursement-common.service';
import {
  CreateTransferDataDto,
  CreateTransferRequestDto,
} from './disbursement.dto';

/**
 * Payouts, over whichever rail the merchant's routing resolves to.
 *
 * **One entry point for every rail.** A bank transfer and an e-wallet top-up are
 * the same operation from the merchant's side and the same row in the database;
 * they differ only in which upstream service carries them, and `bankCode`
 * decides that. Keeping them as sibling services meant two copies of the
 * reserve-and-record sequence, and the copies had already drifted.
 *
 * **The provider owns its own call sequence.** MotionPay will not accept a
 * transfer without an inquiry first; another provider may need no such thing.
 * That is the upstream layer's business, so this service makes exactly one call
 * per payout and never branches on how many round trips it took. What it owns
 * instead is persistence: when the row is written, what goes in it, and what a
 * failure is allowed to say about its status.
 */
@Injectable()
export class DisbursementService {
  private readonly logger = new Logger(DisbursementService.name);

  constructor(
    private readonly common: DisbursementCommonService,
    private readonly motionPayTransferService: MotionPayTransferService,
    private readonly motionPayBillerService: MotionPayBillerService,
    private readonly jatelindoTransferService: JatelindoTransferService,
  ) {}

  /**
   * Send a payout on a merchant's behalf.
   *
   * **Reserve before call, as everywhere else.** The row is written before the
   * provider is asked to move anything, so there can never be money in flight
   * that we have no record of. The reserve necessarily writes the merchant's
   * unverified destination; the provider's confirmed version replaces it when
   * the call returns.
   *
   * Idempotency is the insert's, via `@@unique([merchantId, merchantReference])`.
   * A merchant retrying the same reference is rejected atomically - which for a
   * payout is the difference between paying a recipient once and twice.
   */
  async createTransfer(
    userId: number,
    dto: CreateTransferRequestDto,
  ): Promise<CreateTransferDataDto> {
    const paymentMethodName = paymentMethodByBankCode(dto.bankCode);
    const providerName = await this.common.resolveProvider(
      userId,
      paymentMethodName,
    );

    const systemReference = generateSystemReference({
      userId,
      transactionType: this.common.transactionType,
      paymentMethodName,
      providerName,
      maxLength: this.common.systemReferenceMaxLength(
        providerName,
        paymentMethodName,
      ),
    });

    const disbursementId = await this.common.reserveTransaction({
      userId,
      systemReference,
      providerName,
      paymentMethodName,
      dto,
    });

    const request: UpstreamTransferRequestDto = {
      systemReference,
      merchantReference: dto.merchantReference,
      providerName,
      paymentMethodName,
      amount: dto.amount,
      accountHolderName: dto.accountHolderName ?? null,
      accountNumber: dto.accountNumber,
      bankCode: dto.bankCode,
      note: dto.note ?? dto.merchantReference,
      providerReference: null,
    };

    const transfer = await this.send(disbursementId, request);

    // One update: the combined response carries the provider-confirmed
    // beneficiary and the payment result together.
    await this.common.recordUpstreamResult(disbursementId, transfer);

    return {
      transactionId: systemReference,
      merchantReference: dto.merchantReference,
      status: transfer.status,
      beneficiary: {
        bankCode: transfer.bankCode,
        accountNumber: transfer.accountNumber,
        accountHolderName: transfer.accountHolderName,
      },
    };
  }

  /** Hand the payout to the routed provider, and translate what comes back. */
  private async send(
    disbursementId: number,
    request: UpstreamTransferRequestDto,
  ): Promise<UpstreamTransferResponseDto> {
    try {
      return await this.route(request);
    } catch (error) {
      await this.recordFailure(disbursementId, request, error);
      throw this.toMerchantError(request, error);
    }
  }

  /** Which upstream service carries this payout. The only rail branch here. */
  private route(
    request: UpstreamTransferRequestDto,
  ): Promise<UpstreamTransferResponseDto> {
    const { providerName, paymentMethodName } = request;

    if (ProviderNameEnum.JATELINDO === providerName) {
      return this.jatelindoTransferService.createTransfer(request);
    }

    if (ProviderNameEnum.MOTIONPAY === providerName) {
      // MotionPay reaches wallets over its Biller rails for materially less
      // than its Transfer rails, which is the whole reason the split exists.
      return PaymentMethodNameEnum.TRANSFERBANK === paymentMethodName
        ? this.motionPayTransferService.createTransfer(request)
        : this.motionPayBillerService.createTransfer(request);
    }

    this.logger.error({
      msg: 'No payout client for routed provider',
      providerName,
      paymentMethodName,
      systemReference: request.systemReference,
    });
    throw TransactionException.internalError();
  }

  /**
   * Write what happened to the row, and decide whether it may be called FAILED.
   *
   * **The rule that matters: never assert a failure we cannot verify.** A
   * payment leg that timed out may have moved the money. Marking it FAILED
   * would tell the merchant their payout did not happen while the recipient is
   * holding it - and a merchant who believes that retries, paying twice. Those
   * rows stay PENDING for the status poll to resolve.
   *
   * When the inquiry had already succeeded, its beneficiary is recorded first.
   * Without that, a payout that failed at the payment leg keeps the merchant's
   * unverified destination forever - exactly the row someone later has to
   * explain.
   */
  private async recordFailure(
    disbursementId: number,
    request: UpstreamTransferRequestDto,
    error: unknown,
  ): Promise<void> {
    const transferError =
      error instanceof UpstreamTransferException ? error : null;

    // `UpstreamTransferBeneficiary` is exactly what `recordBeneficiary` takes -
    // that is the point of it being three fields rather than a raw payload.
    if (transferError?.beneficiary) {
      await this.common.recordBeneficiary(
        disbursementId,
        transferError.beneficiary,
      );
    }

    this.logger.error({
      msg: 'Payout failed',
      disbursementId,
      systemReference: request.systemReference,
      providerName: request.providerName,
      paymentMethodName: request.paymentMethodName,
      step: transferError?.step,
      outcomeUnknown: transferError?.outcomeUnknown ?? false,
      error,
    });

    if (transferError?.outcomeUnknown) {
      this.logger.warn({
        msg: 'Payout outcome unknown - left PENDING for the status poll',
        disbursementId,
        systemReference: request.systemReference,
      });
      return;
    }

    await this.common.markFailedFrom(
      disbursementId,
      transferError?.step === UpstreamTransferStep.INQUIRY
        ? METADATA_KEY.TRANSFER_ACCOUNT_INQUIRY_ERROR
        : METADATA_KEY.TRANSFER_PAYMENT_ERROR,
      error,
    );
  }

  /** What the merchant is told. */
  private toMerchantError(
    request: UpstreamTransferRequestDto,
    error: unknown,
  ): TransactionException {
    // Already a decided business failure - routing, validation, our own guards.
    if (error instanceof TransactionException) return error;

    if (error instanceof UpstreamTransferException) {
      if (error.outcomeUnknown) return TransactionException.upstreamTimeout();

      // A beneficiary the provider could not resolve is the merchant's payload
      // to fix. Naming it saves them guessing at an opaque 502.
      if (
        error.step === UpstreamTransferStep.INQUIRY &&
        error.context.beneficiaryValid === false
      ) {
        return TransactionException.invalidBeneficiary(
          `${request.bankCode}/${request.accountNumber}`,
        );
      }
    }

    return this.common.toMerchantFailure(
      error,
      request.systemReference,
      error instanceof UpstreamTransferException
        ? error.step
        : 'createTransfer',
    );
  }
}
