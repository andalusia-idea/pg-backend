import { ProviderNameEnum, TransactionStatusEnum } from '@app/microservice';
import {
  assertUpstreamSchema,
  UpstreamEWalletInquiryResponseDto,
  UpstreamEWalletTopupRequestDto,
  UpstreamEWalletTopupResponseDto,
  UpstreamException,
  UpstreamTransferStatusRequestDto,
  UpstreamTransferStatusResponseDto,
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
  MOTIONPAY_METADATA_KEY,
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
   * Price the top-up and open a transaction at the provider.
   *
   * Throws rather than returning a "not valid" flag, unlike the transfer
   * inquiry: there is no partial success here. A biller inquiry either yields a
   * `transaction_id` the payment leg can use, or the payout cannot proceed.
   */
  async inquiry(
    dto: UpstreamEWalletTopupRequestDto,
  ): Promise<UpstreamEWalletInquiryResponseDto> {
    const context = 'billerInquiry';
    const productCode = motionPayEWalletProductCode(dto.eWallet);

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

    return {
      providerReference: data.transaction_id,
      accountHolderName: data.customer_name ?? '',
      productCode: data.product_code,
      productName: data.product_name,
      nominal: new Decimal(data.amount).toFixed(2),
      fee: new Decimal(data.fee).toFixed(2),
      total: new Decimal(data.total).toFixed(2),
      metadata: {
        [MOTIONPAY_METADATA_KEY.INQUIRY_BILLER]: parsed,
      } as Record<string, unknown>,
    };
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
    dto: UpstreamEWalletTopupRequestDto,
    inquiry: UpstreamEWalletInquiryResponseDto,
  ): Promise<UpstreamEWalletTopupResponseDto> {
    const context = 'billerPayment';

    const body: MotionPayBillerPaymentPrepaidRequestDto = {
      external_id: motionPayBillerPaymentReference(dto.systemReference),
      transaction_id: inquiry.providerReference,
      product_code: inquiry.productCode,
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

    const status = mapMotionPayBillerStatus(parsed.status);

    // Only an outright rejection is an exception. PENDING is the normal result.
    if (status === TransactionStatusEnum.FAILED) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `billerPayment rejected: ${parsed.description || parsed.message}`,
        { status: parsed.status, systemReference: dto.systemReference },
      );
    }

    const data = this.assertData(context, parsed, dto.systemReference);

    return {
      providerReference: data.transaction_id,
      status,
      nominal: new Decimal(data.amount).toFixed(2),
      message: parsed.description || parsed.message || null,
      metadata: {
        [MOTIONPAY_METADATA_KEY.PAYMENT_BILLER]: parsed,
      } as Record<string, unknown>,
    };
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
        [MOTIONPAY_METADATA_KEY.STATUS_BILLER]: parsed,
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
