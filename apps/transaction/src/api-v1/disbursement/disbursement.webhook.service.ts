import {
  isEWalletPaymentMethod,
  MerchantSignatureAuthClient,
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionStatusEnum,
  TransactionTypeEnum,
} from '@app/microservice';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import {
  UpstreamTransferStatusResponseDto,
  UpstreamWebhookTransferDto,
} from '@app/upstream';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@transaction/prisma';
import Decimal from 'decimal.js';
import { firstValueFrom, timeout } from 'rxjs';
import {
  MotionPayBillerService,
  MotionPayTransferService,
} from '../../upstream/motionpay';
import { WebhookPayoutDto } from './disbursement.dto';
import { DisbursementCommonService } from './disbursement-common.service';

/**
 * What the caller should answer the provider with. Mirrors the pay-in flow:
 * `retry` only for a failure a later attempt could plausibly get past.
 */
export type WebhookOutcome = { retry: boolean; reason: string };

const done = (reason: string): WebhookOutcome => ({ retry: false, reason });
const askRetry = (reason: string): WebhookOutcome => ({ retry: true, reason });

/** Statuses a transaction can never move out of. */
const TERMINAL_STATUSES: readonly TransactionStatusEnum[] = [
  TransactionStatusEnum.SUCCESS,
  TransactionStatusEnum.FAILED,
  TransactionStatusEnum.EXPIRED,
  TransactionStatusEnum.CANCELLED,
];

/** A merchant's endpoint gets this long before we give up on this attempt. */
const MERCHANT_WEBHOOK_TIMEOUT_MS = 10_000;

@Injectable()
export class DisbursementWebhookService {
  private readonly logger = new Logger(DisbursementWebhookService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    // No BalanceService here on purpose: the balance effect of a settled payout
    // goes through `common.postPayoutOutcome`, so the leg shapes live in one
    // file rather than being half-known by the webhook.
    private readonly common: DisbursementCommonService,

    private readonly httpService: HttpService,
    private readonly merchantSignatureClient: MerchantSignatureAuthClient,
    private readonly motionPayTransferService: MotionPayTransferService,
    private readonly motionPayBillerService: MotionPayBillerService,
  ) {}

  private readonly transactionType = TransactionTypeEnum.DISBURSEMENT;

  /**
   * Settle a payout from a provider notification.
   *
   * Identical in shape to the pay-in settlement, and identical in principle:
   * the notification is a **trigger**, never a source of truth. Here the case
   * is stronger still - MotionPay's transfer callback carries no signature and
   * no amount, so there is nothing in the body to corroborate against. The
   * authoritative status is re-read over an authenticated call before anything
   * is written.
   *
   * The one structural difference from pay-in: the lookup is by **our**
   * `systemReference`, because that is what the transfer status endpoint is
   * keyed by and what their callback echoes back - the opposite of QRIS.
   */
  async handle(payload: UpstreamWebhookTransferDto): Promise<WebhookOutcome> {
    const disbursement = await this.findDisbursement(payload.systemReference);

    await this.recordWebhook(disbursement?.id ?? null, payload);

    if (!disbursement) {
      this.logger.warn({
        msg: 'Transfer callback for an unknown transaction',
        systemReference: payload.systemReference,
      });
      return done('unknown transaction');
    }

    if (TERMINAL_STATUSES.includes(disbursement.status)) {
      this.logger.debug({
        msg: 'Transfer callback for an already-settled transaction, ignoring',
        disbursementId: disbursement.id,
        status: disbursement.status,
      });
      return done('already terminal');
    }

    const confirmed = await this.confirmWithProvider({
      disbursementId: disbursement.id,
      providerName: disbursement.providerName as ProviderNameEnum,
      paymentMethodName:
        disbursement.paymentMethodName as PaymentMethodNameEnum,
      systemReference: payload.systemReference,
      providerReference: disbursement.providerReference,
    });

    if (!confirmed) return askRetry('status confirmation failed');

    if (confirmed.status === TransactionStatusEnum.PENDING) {
      // Still in flight. For a payout this is the common case rather than an
      // anomaly - transfers settle asynchronously and a callback can arrive
      // ahead of the provider's own state.
      this.logger.warn({
        msg: 'Transfer callback fired but the provider still reports PENDING',
        disbursementId: disbursement.id,
        systemReference: payload.systemReference,
        callbackStatus: payload.status,
      });
      return done('provider still pending');
    }

    await this.settle(disbursement, confirmed, payload);

    return done(`settled as ${confirmed.status}`);
  }

  /**
   * Write the confirmed outcome, then notify the merchant.
   *
   * Every terminal status is written, not only SUCCESS - a rejected payout that
   * stayed PENDING would never release the merchant's funds or show up as
   * needing attention.
   */
  private async settle(
    disbursement: DisbursementRow,
    confirmed: UpstreamTransferStatusResponseDto,
    payload: UpstreamWebhookTransferDto,
  ): Promise<void> {
    const isPaid = confirmed.status === TransactionStatusEnum.SUCCESS;

    // The provider's callback has no timestamp of its own, so the moment we
    // confirmed settlement is the best record we have of when it happened.
    const paidAt = isPaid ? new Date() : null;

    await this.prismaMaster.$transaction(async (tx) => {
      await tx.disbursementTransaction.update({
        where: { id: disbursement.id },
        data: {
          status: confirmed.status,
          paidAt,
          providerReference:
            payload.providerReference ?? confirmed.providerReference,
          metadata: this.mergeMetadata(disbursement.metadata, {
            ...payload.metadata,
            ...confirmed.metadata,
          }),
        },
      });
      await this.common.postPayoutOutcome(tx, {
        disbursementId: disbursement.id,
        merchantId: disbursement.merchantId,
        netNominal: disbursement.netNominal,
        isPaid,
      });
    });

    this.logger.log({
      msg: 'Payout settled from callback',
      disbursementId: disbursement.id,
      status: confirmed.status,
    });

    // From the row, not recomputed. It is the figure the merchant was actually
    // charged - fees are priced and reserved at create time now, so a second
    // call to the fee service here could return a different number under a
    // changed config and report the merchant something that never happened.
    await this.notifyMerchant(
      disbursement,
      confirmed,
      disbursement.netNominal,
      paidAt,
    );
  }

  /**
   * Tell the merchant their payout completed.
   *
   * **Never fatal**, for the same reason as the pay-in webhook: the transaction
   * is already settled, so throwing would make the provider retry a
   * notification we have fully processed - and that retry exits at the
   * terminal-status guard, so the merchant would never be told at all.
   */
  private async notifyMerchant(
    disbursement: DisbursementRow,
    confirmed: UpstreamTransferStatusResponseDto,
    netNominal: Decimal,
    paidAt: Date | null,
  ): Promise<void> {
    try {
      const { payoutUrl } =
        await this.merchantSignatureClient.findMerchantWebhookUrl({
          userId: disbursement.merchantId,
        });
      if (!payoutUrl) return;

      const body: WebhookPayoutDto = {
        transactionId: disbursement.systemReference,
        merchantReference: disbursement.merchantReference,
        amount: { value: disbursement.nominal.toFixed(2), currency: 'IDR' },
        netAmount: { value: netNominal.toFixed(2), currency: 'IDR' },
        fee: {
          value: disbursement.nominal.minus(netNominal).abs().toFixed(2),
          currency: 'IDR',
        },
        status: confirmed.status,
        beneficiary: {
          bankCode: disbursement.bankCode,
          accountNumber: disbursement.accountNumber,
          accountHolderName: disbursement.accountHolderName,
        },
        paidAt: paidAt ? paidAt.toISOString() : null,
      };

      await firstValueFrom(
        this.httpService
          .post<unknown>(payoutUrl, body)
          .pipe(timeout(MERCHANT_WEBHOOK_TIMEOUT_MS)),
      );

      this.logger.log({
        msg: 'Merchant payout webhook delivered',
        disbursementId: disbursement.id,
        merchantId: disbursement.merchantId,
      });
    } catch (error) {
      // TODO(webhook-retry): queue for redelivery with backoff, and expose a
      // manual replay endpoint.
      this.logger.error({
        msg: 'Merchant payout webhook failed - transaction IS settled, merchant was not notified',
        disbursementId: disbursement.id,
        merchantId: disbursement.merchantId,
        error,
      });
    }
  }

  /**
   * Re-read the authoritative status from the provider.
   *
   * Returns null when we could not get an answer, which the caller turns into a
   * retry - never into an assumption. For a payout that restraint matters more
   * than anywhere else in the system: acting on an unverified "success" would
   * release a merchant's funds against money that may never have moved.
   */
  private async confirmWithProvider({
    disbursementId,
    providerName,
    paymentMethodName,
    systemReference,
    providerReference,
  }: {
    disbursementId: number;
    providerName: ProviderNameEnum;
    paymentMethodName: PaymentMethodNameEnum;
    systemReference: string;
    providerReference: string | null;
  }): Promise<UpstreamTransferStatusResponseDto | null> {
    // The payment method decides which rail carried this payout, and therefore
    // which status endpoint knows about it. A wallet top-up sent over the
    // biller rails is invisible to the transfer status endpoint and vice versa.
    const isEWallet = isEWalletPaymentMethod(paymentMethodName);

    try {
      switch (providerName) {
        case ProviderNameEnum.MOTIONPAY:
          // `return await`, not `return`: without the await the promise rejects
          // after this try block has exited and the catch never runs.
          return await (isEWallet
            ? this.motionPayBillerService.checkStatus({
                systemReference,
                providerReference,
              })
            : this.motionPayTransferService.checkTransferStatus({
                systemReference,
                providerReference,
              }));
        default:
          this.logger.error({
            msg: 'No transfer status client for this provider',
            providerName,
            disbursementId,
          });
          return null;
      }
    } catch (error) {
      this.logger.error({
        msg: 'Could not confirm transfer status with the provider',
        systemReference,
        disbursementId,
        error,
      });
      return null;
    }
  }

  private async findDisbursement(systemReference: string) {
    try {
      return await this.prismaMaster.disbursementTransaction.findUniqueOrThrow({
        where: { systemReference },
        select: {
          id: true,
          systemReference: true,
          merchantReference: true,
          merchantId: true,
          providerName: true,
          paymentMethodName: true,
          providerReference: true,
          status: true,
          nominal: true,
          // The amount reserved at create time. Both the balance posting and the
          // merchant notification have to use this exact figure, never a
          // recomputed one.
          netNominal: true,
          accountHolderName: true,
          accountNumber: true,
          bankCode: true,
          metadata: true,
        },
      });
    } catch (error) {
      this.logger.error({
        msg: 'Lookup failed while handling a transfer callback',
        systemReference,
        error,
      });
      return null;
    }
  }

  /** Evidence first, and the raw payload - not our normalised copy. */
  private async recordWebhook(
    disbursementId: number | null,
    payload: UpstreamWebhookTransferDto,
  ): Promise<void> {
    try {
      await this.prismaMaster.webhookLog.create({
        data: {
          transactionId: disbursementId,
          providerReference: payload.providerReference,
          transactionType: this.transactionType,
          source: payload.providerName,
          payload: payload.rawPayload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error({
        msg: 'Could not persist the transfer callback payload',
        systemReference: payload.systemReference,
        error,
      });
    }
  }

  /** Merge new evidence into `metadata` without discarding what is there. */
  private mergeMetadata(
    existing: Prisma.JsonValue,
    additions: Record<string, unknown>,
  ): Prisma.InputJsonValue {
    const base =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};

    return { ...base, ...additions } as Prisma.InputJsonValue;
  }
}

type DisbursementRow = {
  id: number;
  systemReference: string;
  merchantReference: string;
  merchantId: number;
  providerName: string;
  paymentMethodName: string;
  providerReference: string | null;
  status: string;
  nominal: Decimal;
  netNominal: Decimal;
  accountHolderName: string;
  accountNumber: string;
  bankCode: string;
  metadata: Prisma.JsonValue;
};
