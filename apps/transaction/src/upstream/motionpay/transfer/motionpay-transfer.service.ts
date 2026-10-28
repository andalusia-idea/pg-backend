import { Injectable, Logger } from '@nestjs/common';
import {
  METADATA_KEY,
  assertUpstreamSchema,
  UpstreamException,
  UpstreamTransferStatusRequestDto,
  UpstreamTransferStatusResponseDto,
  UpstreamTransferRequestDto,
  UpstreamTransferResponseDto,
  UpstreamTransferBeneficiary,
  UpstreamTransferException,
  UpstreamTransferStep,
  isUpstreamTransportFailure,
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
   * Send a bank payout: inquiry, then transfer, as one operation.
   *
   * **This is the entry point the business layer uses.** That MotionPay needs
   * two round trips for one payout is this service's business, not the
   * disbursement domain's - another provider may do it in one call, or in three,
   * or check something between them. The caller should not have to know. The
   * two legs stay public below because the manual test controllers exercise
   * them individually.
   *
   * The sequence is written out here rather than shared with the Biller rail.
   * They look alike today and will not stay that way: each provider decides
   * what to check between its legs, and a shared runner would have to grow a
   * special case the first time one of them differs.
   *
   * Failures are `UpstreamTransferException`, which names the leg and says
   * whether the outcome is unknown - the caller needs both to decide whether
   * the payout may be called FAILED.
   */
  async createTransfer(
    params: UpstreamTransferRequestDto,
  ): Promise<UpstreamTransferResponseDto> {
    let inquiry: MotionPayAccountInquiryResponseDto;
    try {
      inquiry = await this.accountInquiry(params);
    } catch (error) {
      // An inquiry is a read, so nothing moved - even a timeout here is safe to
      // report as a clean failure.
      throw new UpstreamTransferException({
        provider: ProviderNameEnum.MOTIONPAY,
        message: 'account inquiry failed',
        step: UpstreamTransferStep.INQUIRY,
        outcomeUnknown: false,
        cause: error,
        context: error instanceof Error ? { cause: error.message } : {},
      });
    }

    // A rejected lookup is a business outcome, not a fault: MotionPay answers
    // HTTP 200 with `status.success = false`. Treating an absent throw as
    // success is what would send money to an unverified account.
    if (!this.accountInquiryResolved(inquiry)) {
      throw new UpstreamTransferException({
        provider: ProviderNameEnum.MOTIONPAY,
        message:
          inquiry.status.message ?? 'beneficiary account did not resolve',
        step: UpstreamTransferStep.INQUIRY,
        outcomeUnknown: false,
        context: {
          beneficiaryValid: false,
          [METADATA_KEY.TRANSFER_ACCOUNT_INQUIRY]: inquiry,
        },
      });
    }

    const beneficiary: UpstreamTransferBeneficiary = {
      bankCode: inquiry.data?.bank_code ?? params.bankCode,
      accountNumber: inquiry.data?.bank_account ?? params.accountNumber,
      accountHolderName: inquiry.data?.name ?? '',
    };

    // The bank's spelling of the destination from here on, not the merchant's.
    const confirmed: UpstreamTransferRequestDto = {
      ...params,
      accountHolderName: beneficiary.accountHolderName,
      accountNumber: beneficiary.accountNumber,
    };

    let payment: MotionPayFundTransferResponseDto;
    try {
      payment = await this.fundTransfer(confirmed);
    } catch (error) {
      // The one case where the caller must not assert anything: if the call
      // never got an answer, the money may already have left.
      throw new UpstreamTransferException({
        provider: ProviderNameEnum.MOTIONPAY,
        message: 'fund transfer failed',
        step: UpstreamTransferStep.PAYMENT,
        outcomeUnknown: isUpstreamTransportFailure(error),
        beneficiary,
        cause: error,
        context: error instanceof Error ? { cause: error.message } : {},
      });
    }

    return {
      providerReference: payment.data?.transaction_id ?? '',
      // Only a callback or a status read produces one; inventing a value here
      // would be a lie on the row.
      bankReference: null,

      ...beneficiary,

      status: this.mapStatusCode(payment.status.code),
      nominal: params.amount,
      message: payment.status.message,

      // Both legs' raw payloads, each under its own key, so neither overwrites
      // the other and a dispute can be argued from either.
      metadata: {
        [METADATA_KEY.TRANSFER_ACCOUNT_INQUIRY]: inquiry,
        [METADATA_KEY.TRANSFER_PAYMENT]: payment,
      },
    };
  }

  /**
   * Validate a beneficiary account before sending money to it.
   *
   * A failed lookup is **not** an exception: MotionPay answers HTTP 200 with
   * `status.success = false` and an empty `name`. That is a normal business
   * outcome (wrong account number), so it comes back as `valid: false` rather
   * than throwing — the caller decides whether to abort the payout.
   */
  async accountInquiry(
    params: UpstreamTransferRequestDto,
  ): Promise<MotionPayAccountInquiryResponseDto> {
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

    return parsed;
  }

  /**
   * Whether an inquiry resolved the account.
   *
   * Not a throw, because MotionPay answers HTTP 200 with
   * `status.success = false` for a wrong account number - a normal business
   * outcome, not a fault. `createTransfer` decides what to do about it.
   */
  accountInquiryResolved(parsed: MotionPayAccountInquiryResponseDto): boolean {
    return (
      parsed.status.success &&
      parsed.status.code === MOTIONPAY_TRANSFER_STATUS_CODE.SUCCESS
    );
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
  ): Promise<MotionPayFundTransferResponseDto> {
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

    // Only an outright rejection is an exception. PENDING is the normal result -
    // the expected happy path is `0002 / On Process`, not `0001`.
    if (
      this.mapStatusCode(parsed.status.code) === TransactionStatusEnum.FAILED
    ) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `fundTransfer rejected: ${parsed.status.message}`,
        { status: parsed.status, systemReference: params.systemReference },
      );
    }

    return parsed;
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
        [METADATA_KEY.TRANSFER_STATUS]: parsed,
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
