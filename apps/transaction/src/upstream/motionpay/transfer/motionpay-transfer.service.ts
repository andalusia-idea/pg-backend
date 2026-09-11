import { Injectable, Logger } from '@nestjs/common';
import {
  assertUpstreamSchema,
  UpstreamException,
  UpstreamTransferInquiryRequestDto,
  UpstreamTransferInquiryResponseDto,
  UpstreamTransferRequestDto,
  UpstreamTransferResponseDto,
  UpstreamTransferStatusRequestDto,
  UpstreamTransferStatusResponseDto,
} from '@app/upstream';
import { ProviderNameEnum, TransactionStatusEnum } from '@app/microservice';
import Decimal from 'decimal.js';
import { AxiosError } from 'axios';
import { MotionPayTransferAuthService } from './motionpay-transfer.auth.service';
import {
  MOTIONPAY_TRANSFER_AMOUNT,
  MOTIONPAY_TRANSFER_ENDPOINT,
  MOTIONPAY_TRANSFER_EXTERNAL_ID_MAX_LENGTH,
  MOTIONPAY_TRANSFER_STATUS_CODE,
  MOTIONPAY_METADATA_KEY,
} from '../helper';
import { isKnownMotionPayBankCode } from '../helper';
import {
  MotionPayAccountInquiryRequestDto,
  MotionPayAccountInquiryResponseDto,
  MotionPayAccountInquiryResponseSchema,
  MotionPayBalanceResponseDto,
  MotionPayBalanceResponseSchema,
  MotionPayFundTransferRequestDto,
  MotionPayFundTransferResponseDto,
  MotionPayFundTransferResponseSchema,
  MotionPayTransferStatusResponseDto,
  MotionPayTransferStatusResponseSchema,
} from '../dto';

export interface TransferBalanceResult {
  /** Remaining Flash deposit, in rupiah. */
  deposit: Decimal;
  disbursementId?: number;
  metadata: Record<string, unknown>;
}

/**
 * MotionPay (Flash Mobile) Transfer client — payout to bank accounts and
 * e-wallets, funded from a prepaid Flash deposit.
 *
 * Sibling of `MotionPayService` (QRIS). They share a provider name and nothing
 * else: different host, different token endpoint, different response envelope,
 * different status-code vocabulary. Keeping them apart is deliberate — folding
 * them together would mean a pile of conditionals on which product is in play.
 */
@Injectable()
export class MotionPayTransferService {
  private readonly logger = new Logger(MotionPayTransferService.name);

  constructor(private readonly authService: MotionPayTransferAuthService) {}

  /**
   * How long a `systemReference` this product can carry.
   *
   * Unlike QRIS, this is not our choice: the payout rails send our reference as
   * `external_id` on every leg, and the status endpoint is keyed by it. The
   * caller asks before generating, so an over-long reference is impossible
   * rather than merely caught afterwards — by the time `assertExternalIdLength`
   * fires, the row has already been reserved.
   *
   * Unverified. Their docs give "String, 64" and "max 50 characters" in the
   * same row and we enforce the smaller. The QRIS field turned out to be 255
   * against a documented 16, so this number deserves the same probe before it
   * is trusted.
   */
  readonly systemReferenceMaxLength = MOTIONPAY_TRANSFER_EXTERNAL_ID_MAX_LENGTH;

  /**
   * Validate a beneficiary account before sending money to it.
   *
   * A failed lookup is **not** an exception: MotionPay answers HTTP 200 with
   * `status.success = false` and an empty `name`. That is a normal business
   * outcome (wrong account number), so it comes back as `valid: false` rather
   * than throwing — the caller decides whether to abort the payout.
   */
  async accountInquiry(
    params: UpstreamTransferInquiryRequestDto,
  ): Promise<UpstreamTransferInquiryResponseDto> {
    const body: MotionPayAccountInquiryRequestDto = {
      bank_code: this.assertBankCode(params.bankCode),
      bank_account: params.accountNumber,
      external_id: this.assertExternalIdLength(params.systemReference),
    };

    const raw = await this.request(
      {
        method: 'POST',
        url: MOTIONPAY_TRANSFER_ENDPOINT.ACCOUNT_INQUIRY,
        data: body,
      },
      'accountInquiry',
    );

    const parsed = assertUpstreamSchema<MotionPayAccountInquiryResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      'accountInquiry',
      MotionPayAccountInquiryResponseSchema,
      raw,
    );

    const valid =
      parsed.status.success &&
      parsed.status.code === MOTIONPAY_TRANSFER_STATUS_CODE.SUCCESS;

    return {
      bankCode: parsed.data?.bank_code ?? params.bankCode,
      accountNumber: parsed.data?.bank_account ?? params.accountNumber,
      accountHolderName: parsed.data?.name ?? '',
      valid,
      message: parsed.status.message,
      metadata: { ...parsed } as Record<string, unknown>,
    };
  }

  /**
   * Send money from the Flash deposit to a bank account or e-wallet.
   *
   * Note the expected happy path is `0002 / On Process`, not `0001` — the
   * transfer is accepted and settled asynchronously, with the final state
   * arriving by callback or a status poll. Treating only `0001` as success here
   * would wrongly fail almost every real payout.
   */
  async fundTransfer(
    params: UpstreamTransferRequestDto,
  ): Promise<UpstreamTransferResponseDto> {
    const nominal = new Decimal(params.amount.value);
    const body: MotionPayFundTransferRequestDto = {
      recipient_bank: this.assertBankCode(params.bankCode),
      recipient_account: params.accountNumber,
      amount: this.toWholeRupiah(nominal),
      note: params.note,
      // OUR systemReference, not the merchant's reference: the status endpoint
      // is keyed by this value, so it has to be unique across every merchant.
      external_id: this.assertExternalIdLength(params.systemReference),
      ...(params.accountHolderName
        ? { recipient_name: params.accountHolderName }
        : {}),
    };

    const raw = await this.request(
      {
        method: 'POST',
        url: MOTIONPAY_TRANSFER_ENDPOINT.FUND_TRANSFER,
        data: body,
      },
      'fundTransfer',
    );

    const parsed = assertUpstreamSchema<MotionPayFundTransferResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      'fundTransfer',
      MotionPayFundTransferResponseSchema,
      raw,
    );

    const status = this.mapStatusCode(parsed.status.code);

    // Only an outright rejection is an exception. PENDING is the normal result.
    if (status === TransactionStatusEnum.FAILED) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `fundTransfer rejected: ${parsed.status.message}`,
        { status: parsed.status, systemReference: params.systemReference },
      );
    }

    return {
      providerReference: parsed.data?.transaction_id ?? '',
      status,
      nominal: nominal.toFixed(2),
      message: parsed.status.message,
      metadata: {
        [MOTIONPAY_METADATA_KEY.CREATE_TRANSFER]: parsed,
      } as Record<string, unknown>,
    };
  }

  /**
   * Poll a transfer's state.
   *
   * Keyed by **our** `external_id`, not MotionPay's transaction id — the
   * opposite of the QRIS status endpoint. Worth remembering when writing the
   * reconciliation job.
   */
  async checkTransferStatus(
    dto: UpstreamTransferStatusRequestDto,
  ): Promise<UpstreamTransferStatusResponseDto> {
    const raw = await this.request(
      {
        method: 'GET',
        url: `${MOTIONPAY_TRANSFER_ENDPOINT.TRANSFER_STATUS}/${encodeURIComponent(dto.systemReference)}`,
      },
      'checkTransferStatus',
    );

    const parsed = assertUpstreamSchema<MotionPayTransferStatusResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      'checkTransferStatus',
      MotionPayTransferStatusResponseSchema,
      raw,
    );

    return {
      systemReference: parsed.data?.external_id ?? dto.systemReference,
      providerReference:
        parsed.data?.transaction_id ?? dto.providerReference ?? '',
      // `data.status` and `status.code` should agree; prefer the envelope code
      // since it is the documented vocabulary and is always present.
      status: this.mapStatusCode(parsed.status.code),
      message: parsed.status.message,
      metadata: {
        [MOTIONPAY_METADATA_KEY.STATUS_TRANSFER]: parsed,
      } as Record<string, unknown>,
    };
  }

  /** Remaining Flash deposit available to fund payouts. */
  async checkBalance(): Promise<TransferBalanceResult> {
    const raw = await this.request(
      { method: 'GET', url: MOTIONPAY_TRANSFER_ENDPOINT.BALANCE },
      'checkBalance',
    );

    const parsed = assertUpstreamSchema<MotionPayBalanceResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      'checkBalance',
      MotionPayBalanceResponseSchema,
      raw,
    );

    if (!parsed.status.success || parsed.data?.deposit === undefined) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `checkBalance rejected: ${parsed.status.message}`,
        { status: parsed.status },
      );
    }

    return {
      deposit: new Decimal(parsed.data.deposit),
      disbursementId: parsed.data.disbursement_id,
      metadata: { ...parsed } as Record<string, unknown>,
    };
  }

  private async request(
    config: { method: 'GET' | 'POST'; url: string; data?: unknown },
    context: string,
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

  /**
   * Map MotionPay's transfer status code to ours.
   *
   * Unrecognized codes hold as PENDING, per MotionPay's documented rule that
   * an undefined response code must be recorded as Pending until the next
   * business day's reconciliation resolves it — and because for a payout,
   * guessing "failed" risks a double-send while guessing "success" risks
   * releasing funds that never moved.
   */
  private mapStatusCode(code: string): TransactionStatusEnum {
    switch (code) {
      case MOTIONPAY_TRANSFER_STATUS_CODE.SUCCESS:
        return TransactionStatusEnum.SUCCESS;
      case MOTIONPAY_TRANSFER_STATUS_CODE.FAILED:
        return TransactionStatusEnum.FAILED;
      case MOTIONPAY_TRANSFER_STATUS_CODE.PENDING:
        return TransactionStatusEnum.PENDING;
      default:
        this.logger.warn({
          msg: 'Unrecognized MotionPay transfer status code; holding as PENDING',
          code,
        });
        return TransactionStatusEnum.PENDING;
    }
  }

  private toWholeRupiah(nominal: Decimal): number {
    if (!nominal.isFinite() || !nominal.isInteger()) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `transfer amount [${nominal.toString()}] must be a whole rupiah value`,
      );
    }

    const amount = nominal.toNumber();
    if (
      amount < MOTIONPAY_TRANSFER_AMOUNT.MIN ||
      amount > MOTIONPAY_TRANSFER_AMOUNT.MAX
    ) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `transfer amount [${amount}] is outside the accepted range ${MOTIONPAY_TRANSFER_AMOUNT.MIN}-${MOTIONPAY_TRANSFER_AMOUNT.MAX}`,
      );
    }

    return amount;
  }

  /**
   * Warn on an unknown bank code rather than reject it.
   *
   * The published list is a snapshot; MotionPay can add banks without us
   * redeploying. Blocking an unlisted code would turn their routine addition
   * into our outage, so this logs and lets the upstream be the authority.
   */
  private assertBankCode(bankCode: string): string {
    if (!isKnownMotionPayBankCode(bankCode)) {
      this.logger.warn({
        msg: 'Bank code is not in the known MotionPay list; sending anyway',
        bankCode,
      });
    }
    return bankCode;
  }

  private assertExternalIdLength(code: string): string {
    if (code.length > MOTIONPAY_TRANSFER_EXTERNAL_ID_MAX_LENGTH) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `external_id [${code}] exceeds the ${MOTIONPAY_TRANSFER_EXTERNAL_ID_MAX_LENGTH}-character limit`,
        { length: code.length },
      );
    }
    return code;
  }
}
