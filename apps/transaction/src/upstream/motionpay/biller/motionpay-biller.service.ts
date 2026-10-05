import {
  EWalletEnum,
  ProviderNameEnum,
  TransactionStatusEnum,
} from '@app/microservice';
import {
  METADATA_KEY,
  assertUpstreamSchema,
  UpstreamException,
  UpstreamTransferRequestDto,
  UpstreamTransferStatusRequestDto,
  UpstreamTransferStatusResponseDto,
  UpstreamTransferResponseDto,
  UpstreamTransferBeneficiary,
  UpstreamTransferException,
  UpstreamTransferStep,
  isUpstreamTransportFailure,
} from '@app/upstream';
import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import Decimal from 'decimal.js';
import {
  MotionPayBillerBalanceResponseDto,
  MotionPayBillerBalanceResponseSchema,
  MotionPayBillerInquiryPrepaidRequestDto,
  MotionPayBillerInquiryPrepaidResponseDto,
  MotionPayBillerInquiryPrepaidResponseSchema,
  MotionPayBillerPaymentPrepaidRequestDto,
  MotionPayBillerPaymentPrepaidResponseDto,
  MotionPayBillerPaymentPrepaidResponseSchema,
  MotionPayBillerStatusRequestDto,
  MotionPayBillerStatusResponseDto,
  MotionPayBillerStatusResponseSchema,
} from '../dto';
import {
  MOTIONPAY_BILLER_ENDPOINT,
  MOTIONPAY_BILLER_EXTERNAL_ID_MAX_LENGTH,
  MOTIONPAY_BILLER_PAYMENT_SUFFIX,
  MOTIONPAY_BILLER_STATUS_CODE,
  mapMotionPayBillerStatus,
  motionPayBillerPaymentReference,
  motionPayEWalletProductCode,
} from '../helper';
import { MotionPayBillerAuthService } from './motionpay-biller.auth.service';

/** Deposit remaining on the Biller service - a different pool from Transfer's. */
export interface BillerBalanceResult {
  merchantId: string;
  balance: Decimal;
  currency: string;
  checkedAt: string;
  metadata: Record<string, unknown>;
}

/**
 * MotionPay (Flash Mobile) Biller client — e-wallet top-up only.
 *
 * The third product behind one provider name, and the third set of conventions:
 * its own host, its own token endpoint, its own **integer** status vocabulary
 * (Transfer uses strings, QRIS uses different integers), and its own deposit
 * balance separate from Transfer's.
 *
 * **Why a payment gateway is talking to a bill-payment API.** MotionPay reaches
 * e-wallets through both their Transfer rails and their Biller rails, and the
 * latter is materially cheaper. Nothing else about PPOB is in scope - no
 * airtime, no electricity tokens, no Vision+. Only the wallet top-up products,
 * used as a cheaper route for the same payout a merchant could have made by
 * transfer.
 *
 * **The flow is two calls, and the first one is not free.** Unlike a bank
 * account inquiry, a biller inquiry creates a transaction at the provider and
 * discovers the price; the `transaction_id` it returns is mandatory input to
 * the payment leg. Call `inquiry` then `payment`, and persist what the inquiry
 * returned in between.
 */
@Injectable()
export class MotionPayBillerService {
  private readonly logger = new Logger(MotionPayBillerService.name);

  constructor(private readonly authService: MotionPayBillerAuthService) {}

  /**
   * How long a `systemReference` this product can carry.
   *
   * **The suffix comes out of the budget, not on top of it.** `external_id` is
   * 64 here, but the payment leg sends `{systemReference}-P` (see
   * `motionPayBillerPaymentReference`) — so a reference sized to the full 64
   * would clear the inquiry and then overflow the payment that follows it, at
   * the point where a deposit is about to be debited. Reserving the suffix up
   * front means the two legs cannot disagree about whether a reference fits.
   *
   * Unverified, like Transfer's — see the constant.
   */
  readonly systemReferenceMaxLength =
    MOTIONPAY_BILLER_EXTERNAL_ID_MAX_LENGTH -
    MOTIONPAY_BILLER_PAYMENT_SUFFIX.length;

  /**
   * Send an e-wallet payout: inquiry, then payment, as one operation.
   *
   * **This is the entry point the business layer uses.** Same *contract* as the
   * Transfer rail's `createTransfer` - one call, and an
   * `UpstreamTransferException` naming the leg on failure - so the disbursement
   * domain picks a service and never learns how many round trips it took.
   *
   * The sequence itself is deliberately **not** shared with the Transfer rail,
   * because it is not the same sequence:
   *
   * - **The inquiry is not a free validation.** It opens a transaction at the
   *   provider and prices the product, so a failure between the legs leaves
   *   provider-side state behind. That is why the exception carries the inquiry
   *   result rather than discarding it.
   * - **The payment leg cannot run without the inquiry's reference.** MotionPay
   *   keys the biller payment by the `transaction_id` the inquiry returned, so
   *   `providerReference` has to be threaded from one leg into the next. The
   *   Transfer rail keys its payment by our own `external_id` and needs no such
   *   thing.
   * - **The payment's `external_id` is not the inquiry's.** The spec requires
   *   them to differ, which is what `MOTIONPAY_BILLER_PAYMENT_SUFFIX` is for.
   */
  async createTransfer(
    dto: UpstreamTransferRequestDto,
  ): Promise<UpstreamTransferResponseDto> {
    let inquiry: MotionPayBillerInquiryPrepaidResponseDto;
    try {
      inquiry = await this.inquiry(dto);
    } catch (error) {
      // An inquiry failure leaves a priced-but-unpaid transaction at the
      // provider, not money in flight - so it is still safe to call failed.
      //
      // Unlike the Transfer rail there is no `valid` flag to check afterwards:
      // this leg throws on a rejection rather than reporting one, so a
      // successful return already means the wallet resolved.
      throw new UpstreamTransferException({
        provider: ProviderNameEnum.MOTIONPAY,
        message: 'biller inquiry failed',
        step: UpstreamTransferStep.INQUIRY,
        outcomeUnknown: false,
        cause: error,
        context: error instanceof Error ? { cause: error.message } : {},
      });
    }

    // A failed biller call answers `"data": {}` rather than the documented
    // object, so the envelope's `data` is a union until this narrows it. The
    // inquiry leg has already proved it is populated; this is the type-level
    // half of the same guarantee.
    const inquiryData = this.assertData(
      'billerInquiry',
      inquiry,
      dto.systemReference,
    );

    const beneficiary: UpstreamTransferBeneficiary = {
      // `bankCode` carries the wallet name on this rail - see the note on
      // DisbursementTransaction.bankCode.
      bankCode: dto.bankCode,
      accountNumber: dto.accountNumber,
      // A wallet top-up may resolve no name at all, so an empty string is the
      // honest answer rather than echoing back the merchant's guess.
      accountHolderName: inquiryData.customer_name ?? '',
    };

    // `providerReference` is the provider's `transaction_id`, and threading it
    // into the payment leg is the one thing that makes this rail's sequence
    // different from the Transfer rail's - that leg is keyed by it.
    const confirmed: UpstreamTransferRequestDto = {
      ...dto,
      accountHolderName: beneficiary.accountHolderName,
      providerReference: inquiryData.transaction_id,
    };

    let payment: MotionPayBillerPaymentPrepaidResponseDto;
    try {
      payment = await this.payment(confirmed);
    } catch (error) {
      // Past this point the provider may have debited our deposit and credited
      // the wallet. A call that got no answer must not be called failed.
      throw new UpstreamTransferException({
        provider: ProviderNameEnum.MOTIONPAY,
        message: 'biller payment failed',
        step: UpstreamTransferStep.PAYMENT,
        outcomeUnknown: isUpstreamTransportFailure(error),
        beneficiary,
        cause: error,
        context: error instanceof Error ? { cause: error.message } : {},
      });
    }

    const paymentData = this.assertData(
      'billerPayment',
      payment,
      dto.systemReference,
    );

    return {
      providerReference: paymentData.transaction_id,
      bankReference: null,

      ...beneficiary,

      status: mapMotionPayBillerStatus(payment.status),
      nominal: dto.amount,
      message: payment.description || payment.message || null,

      // Both legs' raw payloads under their own keys. The inquiry's is worth
      // keeping beside the payment's: it carries the product code and the price
      // this payout was quoted at, which is what a cost comparison against the
      // Transfer rail is actually made on.
      metadata: {
        [METADATA_KEY.TRANSFER_ACCOUNT_INQUIRY]: inquiry,
        [METADATA_KEY.TRANSFER_PAYMENT]: payment,
      },
    };
  }

  /**
   * Price the top-up and open a transaction at the provider.
   *
   * Throws rather than returning a "not valid" flag, unlike the transfer
   * inquiry: there is no partial success here. A biller inquiry either yields a
   * `transaction_id` the payment leg can use, or the payout cannot proceed.
   */
  async inquiry(
    dto: UpstreamTransferRequestDto,
  ): Promise<MotionPayBillerInquiryPrepaidResponseDto> {
    const context = 'billerInquiry';
    const productCode = motionPayEWalletProductCode(
      dto.bankCode as EWalletEnum,
    );

    const body: MotionPayBillerInquiryPrepaidRequestDto = {
      external_id: dto.systemReference,
      product_code: productCode,
      customer_id: dto.accountNumber,
      // Open-amount products take the nominal from us. Whole rupiah on the
      // wire, as everywhere else with this provider.
      nominal: new Decimal(dto.amount.value).toFixed(0),
    };

    const raw = await this.request(context, {
      method: 'POST',
      url: MOTIONPAY_BILLER_ENDPOINT.INQUIRY,
      data: body,
    });

    const parsed =
      assertUpstreamSchema<MotionPayBillerInquiryPrepaidResponseDto>(
        ProviderNameEnum.MOTIONPAY,
        context,
        MotionPayBillerInquiryPrepaidResponseSchema,
        raw,
      );

    const data = this.assertData(context, parsed, dto.systemReference);

    if (parsed.status !== MOTIONPAY_BILLER_STATUS_CODE.SUCCESS) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `billerInquiry rejected: ${parsed.description || parsed.message}`,
        { status: parsed.status, systemReference: dto.systemReference },
      );
    }

    // Proven here rather than left to the caller: the payment leg is keyed by
    // this `transaction_id`, so an inquiry that came back without one cannot be
    // paid against and is better refused at the leg that produced it.
    if (!data.transaction_id) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        'billerInquiry returned no transaction_id to pay against',
        { systemReference: dto.systemReference },
      );
    }

    return parsed;
  }

  /**
   * Confirm the top-up, debiting our Biller deposit.
   *
   * `external_id` is deliberately **not** the one the inquiry used - the spec
   * requires them to differ, and reusing it returns "Duplicate External ID".
   * It is derived from our `systemReference` so the status endpoint, which is
   * keyed by this value, stays reachable from the row.
   *
   * `202 Pending` is a normal outcome, not a failure: top-ups settle
   * asynchronously with the final state arriving by callback.
   */
  async payment(
    dto: UpstreamTransferRequestDto,
  ): Promise<MotionPayBillerPaymentPrepaidResponseDto> {
    const context = 'billerPayment';

    const productCode = motionPayEWalletProductCode(
      dto.bankCode as EWalletEnum,
    );

    const body: MotionPayBillerPaymentPrepaidRequestDto = {
      external_id: motionPayBillerPaymentReference(dto.systemReference),
      transaction_id: dto.providerReference!,
      product_code: productCode,
      customer_id: dto.accountNumber,
    };

    const raw = await this.request(context, {
      method: 'POST',
      url: MOTIONPAY_BILLER_ENDPOINT.PAYMENT,
      data: body,
    });

    const parsed =
      assertUpstreamSchema<MotionPayBillerPaymentPrepaidResponseDto>(
        ProviderNameEnum.MOTIONPAY,
        context,
        MotionPayBillerPaymentPrepaidResponseSchema,
        raw,
      );

    // Only an outright rejection is an exception. PENDING is the normal result -
    // top-ups settle asynchronously, with the final state arriving by callback.
    if (
      mapMotionPayBillerStatus(parsed.status) === TransactionStatusEnum.FAILED
    ) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `billerPayment rejected: ${parsed.description || parsed.message}`,
        { status: parsed.status, systemReference: dto.systemReference },
      );
    }

    // Asserted here, not in `createTransfer`: a payment accepted with no data
    // block has nothing the row can be reconciled by.
    this.assertData(context, parsed, dto.systemReference);

    return parsed;
  }

  /**
   * Poll a top-up's state.
   *
   * Keyed by the **payment leg's** `external_id`, which is derived rather than
   * stored - see `motionPayBillerPaymentReference`.
   */
  async checkStatus(
    dto: UpstreamTransferStatusRequestDto,
  ): Promise<UpstreamTransferStatusResponseDto> {
    const context = 'billerCheckStatus';

    const body: MotionPayBillerStatusRequestDto = {
      external_id: motionPayBillerPaymentReference(dto.systemReference),
    };

    const raw = await this.request(context, {
      method: 'POST',
      url: MOTIONPAY_BILLER_ENDPOINT.CHECK_STATUS,
      data: body,
    });

    const parsed = assertUpstreamSchema<MotionPayBillerStatusResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      context,
      MotionPayBillerStatusResponseSchema,
      raw,
    );

    const data = this.assertData(context, parsed, dto.systemReference);

    return {
      systemReference: dto.systemReference,
      providerReference: data.transaction_id || (dto.providerReference ?? ''),
      status: mapMotionPayBillerStatus(parsed.status),
      message: parsed.description || parsed.message || null,
      metadata: {
        [METADATA_KEY.TRANSFER_STATUS]: parsed,
      } as Record<string, unknown>,
    };
  }

  /** Deposit remaining on the Biller service. A different pool from Transfer's. */
  async checkBalance(): Promise<BillerBalanceResult> {
    const context = 'billerBalance';

    const raw = await this.request(context, {
      method: 'POST',
      url: MOTIONPAY_BILLER_ENDPOINT.BALANCE,
    });

    const parsed = assertUpstreamSchema<MotionPayBillerBalanceResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      context,
      MotionPayBillerBalanceResponseSchema,
      raw,
    );

    const data = this.assertData(context, parsed, 'balance');

    return {
      merchantId: data.merchant_id,
      balance: new Decimal(data.balance),
      currency: data.currency,
      checkedAt: data.checked_at,
      metadata: { ...parsed } as Record<string, unknown>,
    };
  }

  /**
   * Narrow a response envelope to its populated `data`.
   *
   * A failed biller call answers with `"data": {}` rather than the documented
   * object, so this is where an error envelope stops looking like a success
   * with missing fields.
   */
  private assertData<
    T extends { status: number; message: string; description: string },
  >(
    context: string,
    parsed: T & { data: unknown },
    systemReference: string,
  ): Record<string, string> {
    const data = parsed.data as Record<string, string> | null;

    if (!data || Object.keys(data).length === 0) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `${context} returned no data: ${parsed.description || parsed.message}`,
        { status: parsed.status, systemReference },
      );
    }

    return data;
  }

  private async request(
    context: string,
    config: { method: 'GET' | 'POST'; url: string; data?: unknown },
  ): Promise<unknown> {
    try {
      return await this.authService.authorizedRequest<unknown>(config);
    } catch (error) {
      if (error instanceof UpstreamException) throw error;

      const axiosError = error as AxiosError;
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `${context} request failed`,
        {
          status: axiosError.response?.status,
          response: axiosError.response?.data,
        },
      );
    }
  }
}
