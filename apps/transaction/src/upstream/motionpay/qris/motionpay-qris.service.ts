import { Injectable, Logger } from '@nestjs/common';
import {
  assertUpstreamSchema,
  UpstreamQrisRequestDto,
  UpstreamQrisResponseDto,
  UpstreamException,
  UpstreamQrisStatusResponseDto,
  UpstreamQrisStatusRequestDto,
} from '@app/upstream';
import Decimal from 'decimal.js';
import { AxiosError } from 'axios';
import { MotionPayConfig } from '@app/configuration';
import { MotionPayQrisAuthService } from './motionpay-qris.auth.service';
import {
  MOTIONPAY_AMOUNT,
  MOTIONPAY_QRIS_ENDPOINT,
  MOTIONPAY_EXTERNAL_ID_MAX_LENGTH,
  MOTIONPAY_STATUS_CODE,
  MOTIONPAY_METADATA_KEY,
  getMotionPayTimestampSkewHours,
  mapMotionPayStatus,
} from '../helper';
import {
  MotionPayCreateQrisRequestDto,
  MotionPayCreateQrisResponseDto,
  MotionPayCreateQrisResponseSchema,
  MotionPayQrisStatusResponseDto,
  MotionPayQrisStatusResponseSchema,
} from '../dto';
import { HttpMethodEnum, ProviderNameEnum } from '@app/microservice';

const SECONDS_PER_MINUTE = 60;

@Injectable()
export class MotionPayQrisService {
  private readonly logger = new Logger(MotionPayQrisService.name);

  constructor(
    private readonly authService: MotionPayQrisAuthService,
    private readonly motionPayConfig: MotionPayConfig,
  ) {}

  async createQRIS(
    dto: UpstreamQrisRequestDto,
  ): Promise<UpstreamQrisResponseDto> {
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
      // A terminal identifier, not a transaction one - it is embedded in the QR
      // payload. Was `externalId`, which wrote a distinct "terminal" into every
      // single QR. See MotionPayConfig.TERMINAL_ID.
      terminal_id: this.motionPayConfig.MERCHANT_ID,
      external_id: externalId,
      amount: this.toWholeRupiah(new Decimal(dto.amount.value)),
      description: dto.merchantReference,
      session_time: sessionTimeMinutes,
      fullname: '',
      email: '',
      phone_number: '',
    };

    const requestSentAt = new Date();
    const raw = await this.request(context, {
      method: 'POST',
      url: MOTIONPAY_QRIS_ENDPOINT.CREATE_QRIS_PAYMENT,
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
    this.assertTimestampMode(data.created_date, requestSentAt);
    const res: UpstreamQrisResponseDto = {
      providerReference: data.transaction_id,
      qrString: data.qr_string,
      nominal: new Decimal(data.amount).toFixed(2),
      expiresAt,
      status: mapMotionPayStatus({ status: data.status }),
      message: data.description ?? null,
      metadata: {
        [MOTIONPAY_METADATA_KEY.CREATE_QRIS]: parsed,
      } as Record<string, unknown>,
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
      url: MOTIONPAY_QRIS_ENDPOINT.CREATE_QRIS_PAYMENT,
      data: body,
    });
  }

  /**
   * Look up a payment by MotionPay's `transaction_id` (the `FM-…` value
   * returned at creation) — there is no documented lookup by our own code.
   */
  async getQrisStatus(
    dto: UpstreamQrisStatusRequestDto,
  ): Promise<UpstreamQrisStatusResponseDto> {
    const raw = await this.request('getQrisStatus', {
      method: 'GET',
      url: `${MOTIONPAY_QRIS_ENDPOINT.QRIS_PAYMENT_STATUS}/${encodeURIComponent(dto.providerReference)}`,
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
        { status: parsed.status, transactionId: dto.providerReference },
      );
    }

    const data = parsed.data;

    return {
      merchantReference: data.external_id,
      providerReference: data.transaction_id,
      // The full mapper, not a bare status lookup: MotionPay has no EXPIRED
      // state, so an expiry only becomes visible by combining the status with
      // the description and the expiry/paid timestamps.
      status: mapMotionPayStatus({
        status: data.status,
        description: data.description,
        expiredDate: data.expired_date,
        paidDate: data.paid_date,
      }),
      nominal: new Decimal(data.amount).toFixed(2),
      paidAt: data.paid_date ?? null,
      expiresAt: data.expired_date ?? null,
      metadata: {
        [MOTIONPAY_METADATA_KEY.STATUS_QRIS]: parsed,
      } as Record<string, unknown>,
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

  /**
   * Check that we are still reading MotionPay's timestamps the way they mean
   * them.
   *
   * `created_date` describes a transaction created moments ago, so our own
   * clock is ground truth and this costs nothing. The v2.7 spec and the
   * sandbox disagree by seven hours about what the printed offset means (see
   * motionpay.helper.ts); this is what tells us if the answer ever changes,
   * on the day it changes rather than at the next reconciliation.
   */
  private assertTimestampMode(created: string | undefined, sentAt: Date): void {
    const skewHours = getMotionPayTimestampSkewHours(created, sentAt);
    if (skewHours === null || Math.abs(skewHours) < 1) return;

    this.logger.error({
      msg: 'MotionPay timestamp skew - the timezone assumption may have changed. Check MotionPayTimestampMode in motionpay.helper.ts.',
      created,
      ourClock: sentAt.toISOString(),
      skewHours: Number(skewHours.toFixed(2)),
    });
  }

  private emptyToUndefined(value?: string): string | undefined {
    return value === undefined || value === '' ? undefined : value;
  }
}
