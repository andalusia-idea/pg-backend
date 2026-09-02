import { Injectable, Logger } from '@nestjs/common';
import {
  assertUpstreamSchema,
  UpstreamException,
  UpstreamPurchaseStatusResult,
  PurchaseUpstreamRequestDto,
  PurchaseUpstreamResponseDto,
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
import {
  HttpMethodEnum,
  ProviderNameEnum,
  TransactionStatusEnum,
} from '@app/microservice';

const SECONDS_PER_MINUTE = 60;

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
export class MotionPayQRISService {
  private readonly logger = new Logger(MotionPayQRISService.name);

  constructor(private readonly authService: MotionPayAuthService) {}

  async createQRIS(
    dto: PurchaseUpstreamRequestDto,
  ): Promise<PurchaseUpstreamResponseDto> {
    const context = this.createQRIS.name;

    // Was `.slice(0, 16)`. Truncating silently is the one thing that must not
    // happen here: `external_id` is how a callback and the next day's
    // reconciliation file find their way back to this transaction, so a
    // shortened value does not fail - it quietly stops matching. Fails loudly
    // instead, per assertExternalIdLength's own note.
    const externalId = this.assertExternalIdLength(
      dto.merchantReference,
      'merchantReference',
    );

    // Whole minutes, floored: `session_time` is documented in minutes, and the
    // previous `% 60` was a modulo rather than a division - it turned the
    // minimum 600s into `session_time: 0`, i.e. every QR asked for zero
    // minutes of validity.
    const sessionTimeMinutes = Math.floor(
      dto.expireSeconds / SECONDS_PER_MINUTE,
    );

    // Computed before the request goes out, from the floored minutes rather
    // than the seconds asked for, so what we tell the merchant matches what the
    // provider actually enforces. The create response carries no expiry field -
    // only `created_date`, whose format differs between their own samples - so
    // deriving it from our own clock is the only honest option.
    const expiresAt = new Date(
      Date.now() + sessionTimeMinutes * SECONDS_PER_MINUTE * 1000,
    ).toISOString();

    const body: MotionPayCreateQrisRequestDto = {
      terminal_id: externalId,
      external_id: externalId,
      amount: this.toWholeRupiah(new Decimal(dto.amount.value)),
      description: dto.merchantReference,
      session_time: sessionTimeMinutes,
      fullname: '',
      email: '',
      phone_number: '',
    };

    const raw = await this.request(context, {
      method: 'POST',
      url: MOTIONPAY_ENDPOINT.CREATE_QRIS_PAYMENT,
      data: body,
    });
    const parsed = assertUpstreamSchema<MotionPayCreateQrisResponseDto>(
      context,
      ProviderNameEnum.MOTIONPAY,
      MotionPayCreateQrisResponseSchema,
      raw,
    );
    if (
      parsed.status.code !== MOTIONPAY_STATUS_CODE.PAYMENT_OK ||
      !parsed.data
    ) {
      throw new UpstreamException(
        ProviderNameEnum.MOTIONPAY,
        `createQrisPayment rejected: ${parsed.status.message}`,
        { status: parsed.status, systemReference: dto.systemReference },
      );
    }

    const data = parsed.data;
    const res: PurchaseUpstreamResponseDto = {
      providerReference: data.transaction_id,
      qrString: data.qr_string,
      nominal: new Decimal(data.amount).toFixed(2),
      expiresAt,
      status: this.mapStatus(data.status),
      message: data.description ?? null,
      metadata: { ...parsed } as Record<string, unknown>,
    };
    return res;
  }

  /**
   * Send a create-payment request exactly as given and return MotionPay's
   * reply verbatim — no request mapping, no response normalization.
   *
   * Exists so the wire contract can be exercised directly while the
   * integration is still being commissioned (paste MotionPay's documented
   * example, see precisely what they answer). Keeping it as its own method is
   * what lets `createQrisPayment` above stay strict: the test path never has
   * to loosen the production path.
   *
   * Not for business use — no envelope check, no typed response.
   */
  async createQrisPaymentRaw(
    body: MotionPayCreateQrisRequestDto,
  ): Promise<unknown> {
    // const data: MotionPayCreateQrisRequestDto = {
    // terminal_id: '1234567890123456',
    // external_id: '1234567890123456',
    // amount: 10000,
    // session_time: 3,
    // fullname: '',
    // email: '',
    // phone_number: '',
    //////////
    // terminal_id: 'PRODUCT-01',
    // external_id: '2023-02',
    // amount: 1000,
    // description: 'Description of transaction',
    // session_time: 3,
    // fullname: 'John Doe',
    // email: 'email@email.com',
    // phone_number: '081510076749',
    /////////
    // terminal_id: 'PRODUCT01',
    // external_id: 'PRD2608131733001',
    // amount: 1000,
    // description: 'QR Dynamic Test',
    // session_time: 60,
    // fullname: 'Test Transaction',
    // email: 'test@Transaction.com',
    // phone_number: '0816122025',
    // };
    return this.request('createQrisPaymentRaw', {
      method: 'POST',
      url: MOTIONPAY_ENDPOINT.CREATE_QRIS_PAYMENT,
      data: body,
    });
  }

  /**
   * Look up a payment by MotionPay's `transaction_id` (the `FM-…` value
   * returned at creation) — there is no documented lookup by our own code.
   */
  async getQrisStatus(
    transactionId: string,
  ): Promise<UpstreamPurchaseStatusResult> {
    const raw = await this.request('getQrisStatus', {
      method: 'GET',
      url: `${MOTIONPAY_ENDPOINT.QRIS_PAYMENT_STATUS}/${encodeURIComponent(transactionId)}`,
    });

    const parsed = assertUpstreamSchema<MotionPayQrisStatusResponseDto>(
      'getQrisStatus',
      ProviderNameEnum.MOTIONPAY,
      MotionPayQrisStatusResponseSchema,
      raw,
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
    context: string,
    config: { method: HttpMethodEnum; url: string; data?: unknown },
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
  private mapStatus(status: string): TransactionStatusEnum {
    switch (status?.toUpperCase()) {
      case MOTIONPAY_TRANSACTION_STATUS.SUCCESS:
        return TransactionStatusEnum.SUCCESS;
      case MOTIONPAY_TRANSACTION_STATUS.FAILED:
        return TransactionStatusEnum.FAILED;
      case MOTIONPAY_TRANSACTION_STATUS.PENDING:
        return TransactionStatusEnum.PENDING;
      default:
        this.logger.warn(
          `Unrecognized MotionPay status [${status}]; holding as PENDING`,
        );
        return TransactionStatusEnum.PENDING;
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
