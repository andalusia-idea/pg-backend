import { Injectable, Logger } from '@nestjs/common';
import {
  assertUpstreamSchema,
  UpstreamException,
  UpstreamPurchaseResult,
  UpstreamPurchaseStatusResult,
  UpstreamTransactionStatusEnum,
} from '@app/upstream';
import Decimal from 'decimal.js';
import { AxiosError } from 'axios';
import { MotionPayAuthService } from './motionpay-auth.service';
import {
  MOTIONPAY_AMOUNT,
  MOTIONPAY_ENDPOINT,
  MOTIONPAY_EXTERNAL_ID_MAX_LENGTH,
  MOTIONPAY_STATUS_CODE,
  MOTIONPAY_TRANSACTION_STATUS,
} from './motionpay.constant';
import {
  MotionPayCreateQrisRequestDto,
  MotionPayCreateQrisResponseDto,
  MotionPayCreateQrisResponseSchema,
  MotionPayQrisStatusResponseDto,
  MotionPayQrisStatusResponseSchema,
} from './dto';
import { ProviderNameEnum } from '@app/microservice';

export interface CreateQrisPaymentParams {
  /** Our transaction correlation code. Also used as `external_id`. */
  code: string;
  nominal: Decimal;
  /** QR validity in minutes. */
  sessionTimeMinutes: number;
  description?: string;
  terminalId?: string;
  customer?: {
    fullname?: string;
    email?: string;
    phoneNumber?: string;
  };
}

@Injectable()
export class MotionPayService {
  private readonly logger = new Logger(MotionPayService.name);

  constructor(private readonly authService: MotionPayAuthService) {}

  /**
   * Create a dynamic QRIS payment.
   *
   * Returns the normalized upstream shape, never MotionPay's wire format — the
   * business layer should not need to know which provider handled a purchase.
   */
  async createQrisPayment(
    body: MotionPayCreateQrisRequestDto,
  ): Promise<UpstreamPurchaseResult> {
    const params = { code: '111' };
    // const body: MotionPayCreateQrisRequestDto = {
    //   terminal_id: this.assertExternalIdLength(
    //     params.terminalId ?? params.code,
    //     'terminal_id',
    //   ),
    //   external_id: this.assertExternalIdLength(params.code, 'external_id'),
    //   amount: this.toWholeRupiah(params.nominal),
    //   session_time: params.sessionTimeMinutes,
    //   // Required keys, but the provider allows empty values.
    //   fullname: params.customer?.fullname ?? '',
    //   email: params.customer?.email ?? '',
    //   phone_number: params.customer?.phoneNumber ?? '',
    //   ...(params.description ? { description: params.description } : {}),
    // };
    this.logger.log(body);

    const raw = await this.request(
      {
        method: 'POST',
        url: MOTIONPAY_ENDPOINT.CREATE_QRIS_PAYMENT,
        data: body,
      },
      'createQrisPayment',
    );
    this.logger.log('createQrisPayment');
    this.logger.log(raw);

    const parsed = assertUpstreamSchema<MotionPayCreateQrisResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      MotionPayCreateQrisResponseSchema,
      raw,
      'createQrisPayment',
    );

    // The envelope code is authoritative, not the HTTP status: a Krakend
    // gateway fronts this API and returns logical failures inside HTTP 200.
    if (
      parsed.status.code !== MOTIONPAY_STATUS_CODE.PAYMENT_OK ||
      !parsed.data
    ) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `createQrisPayment rejected: ${parsed.status.message}`,
        { status: parsed.status, code: params.code },
      );
    }

    const data = parsed.data;

    return {
      code: params.code,
      externalId: data.transaction_id,
      status: this.mapStatus(data.status),
      nominal: new Decimal(data.amount),
      content: data.qr_string,
      message: data.description ?? parsed.status.message,
      metadata: { ...parsed } as Record<string, unknown>,
    };
  }

  /**
   * Look up a payment by MotionPay's `transaction_id` (the `FM-…` value
   * returned at creation) — there is no documented lookup by our own code.
   */
  async getQrisStatus(
    transactionId: string,
  ): Promise<UpstreamPurchaseStatusResult> {
    const raw = await this.request(
      {
        method: 'GET',
        url: `${MOTIONPAY_ENDPOINT.QRIS_PAYMENT_STATUS}/${encodeURIComponent(transactionId)}`,
      },
      'getQrisStatus',
    );

    const parsed = assertUpstreamSchema<MotionPayQrisStatusResponseDto>(
      ProviderNameEnum.MOTIONPAY,
      MotionPayQrisStatusResponseSchema,
      raw,
      'getQrisStatus',
    );

    if (
      parsed.status.code !== MOTIONPAY_STATUS_CODE.PAYMENT_OK ||
      !parsed.data
    ) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `getQrisStatus rejected: ${parsed.status.message}`,
        { status: parsed.status, transactionId },
      );
    }

    const data = parsed.data;

    return {
      code: data.external_id,
      externalId: data.transaction_id,
      status: this.mapStatus(data.status),
      nominal: new Decimal(data.amount),
      message: data.description ?? parsed.status.message,
      // Empty strings are how this provider represents "not settled yet";
      // normalize them away so callers can rely on presence checks.
      rrn: this.emptyToUndefined(data.rrn),
      paidAt: this.emptyToUndefined(data.paid_date),
      expiresAt: this.emptyToUndefined(data.expired_date),
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
   * Map MotionPay's status to ours.
   *
   * Anything unrecognized maps to PENDING, which is both what MotionPay's docs
   * mandate for undefined response codes (hold as Pending until next-day
   * reconciliation resolves it) and the safe direction for a payment system —
   * never assert paid or failed on a status we do not understand.
   *
   * MotionPay has no EXPIRED state, so EXPIRED is never produced here; expiry
   * has to be derived from `expired_date` by the caller once the provider's
   * real behaviour on expiry is confirmed.
   */
  private mapStatus(status: string): UpstreamTransactionStatusEnum {
    switch (status?.toUpperCase()) {
      case MOTIONPAY_TRANSACTION_STATUS.SUCCESS:
        return UpstreamTransactionStatusEnum.SUCCESS;
      case MOTIONPAY_TRANSACTION_STATUS.FAILED:
        return UpstreamTransactionStatusEnum.FAILED;
      case MOTIONPAY_TRANSACTION_STATUS.PENDING:
        return UpstreamTransactionStatusEnum.PENDING;
      default:
        this.logger.warn(
          `Unrecognized MotionPay status [${status}]; holding as PENDING`,
        );
        return UpstreamTransactionStatusEnum.PENDING;
    }
  }

  /**
   * Convert our Decimal amount to the whole-rupiah integer the provider wants.
   *
   * Rejects fractional values rather than rounding: silently rounding money
   * before sending it upstream creates a mismatch between what we recorded and
   * what the customer is charged.
   */
  private toWholeRupiah(nominal: Decimal): number {
    if (!nominal.isFinite() || !nominal.isInteger()) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `amount [${nominal.toString()}] must be a whole rupiah value`,
      );
    }

    const amount = nominal.toNumber();
    if (amount < MOTIONPAY_AMOUNT.MIN || amount > MOTIONPAY_AMOUNT.MAX) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `amount [${amount}] is outside the accepted range ${MOTIONPAY_AMOUNT.MIN}-${MOTIONPAY_AMOUNT.MAX}`,
      );
    }

    return amount;
  }

  /**
   * Fail loudly instead of truncating.
   *
   * `external_id` is documented as String(16) but our transaction code is
   * longer, and MotionPay's own samples exceed 16 too — see the open question
   * in docs/upstream/motionpay.md. Truncating would silently break callback
   * and reconciliation matching, so this throws until the real limit is
   * confirmed with their team.
   */
  private assertExternalIdLength(value: string, field: string): string {
    if (value.length > MOTIONPAY_EXTERNAL_ID_MAX_LENGTH) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `${field} [${value}] exceeds the documented ${MOTIONPAY_EXTERNAL_ID_MAX_LENGTH}-character limit`,
        { field, length: value.length },
      );
    }
    return value;
  }

  private emptyToUndefined(value?: string): string | undefined {
    return value === undefined || value === '' ? undefined : value;
  }
}
