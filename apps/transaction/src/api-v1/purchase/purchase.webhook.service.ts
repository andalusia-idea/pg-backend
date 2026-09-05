import {
  FeeCalculateConfigClient,
  FeeCalculationResultDto,
  FeeTypeEnum,
  MerchantSignatureAuthClient,
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionStatusEnum,
  TransactionTypeEnum,
} from '@app/microservice';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import {
  UpstreamQrisStatusResponseDto,
  UpstreamWebhookQrisDto,
} from '@app/upstream';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@transaction/prisma';
import Decimal from 'decimal.js';
import { firstValueFrom, timeout } from 'rxjs';
import { MotionPayQrisService } from '../../upstream/motionpay';
import { WebhookPayinDto } from './purchase.dto';

/**
 * What the caller should answer the provider with.
 *
 * MotionPay retries a non-200 three times at five-minute intervals, then drops
 * the notification permanently. So `retry` is only ever true for a failure that
 * a later attempt could plausibly get past - never for something that will
 * still be true in five minutes.
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
export class PurchaseWebhookService {
  private readonly logger = new Logger(PurchaseWebhookService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,

    private readonly httpService: HttpService,
    private readonly feeCalculateClient: FeeCalculateConfigClient,
    private readonly merchantSignatureClient: MerchantSignatureAuthClient,
    private readonly motionPayQrisService: MotionPayQrisService,
  ) {}

  private readonly transactionType = TransactionTypeEnum.PURCHASE;
  private readonly paymentMethodName = PaymentMethodNameEnum.QRIS;

  /**
   * Settle a purchase from a provider payment notification.
   *
   * The notification is a **trigger**, never a source of truth - MotionPay
   * publishes no callback signature, so a forged `SUCCESS` would otherwise
   * credit a merchant. The authoritative status is re-read over an
   * authenticated call before anything is written.
   *
   * The flow, and every step's failure is deliberate:
   *
   * 1. log the raw payload - evidence first, matched or not;
   * 2. find our transaction; unknown means stop, no retry will help;
   * 3. terminal already means stop, which is what makes retries idempotent;
   * 4. confirm the real status with the provider;
   * 5. write the outcome - fees only on SUCCESS;
   * 6. notify the merchant, separately and non-fatally.
   */
  async handle(payload: UpstreamWebhookQrisDto): Promise<WebhookOutcome> {
    const purchase = await this.findPurchase(payload.providerReference);

    await this.recordWebhook(purchase?.id ?? null, payload);

    if (!purchase) {
      this.logger.warn({
        msg: 'QRIS callback for an unknown transaction',
        providerReference: payload.providerReference,
      });
      return done('unknown transaction');
    }

    if (TERMINAL_STATUSES.includes(purchase.status as TransactionStatusEnum)) {
      // The idempotency guard. MotionPay retries, and a duplicate must not
      // re-run the fee calculation, re-notify the merchant, or later move a
      // balance twice. The payload is still logged above, so a duplicate is
      // recorded even though it changes nothing.
      this.logger.debug({
        msg: 'QRIS callback for an already-settled transaction, ignoring',
        purchaseId: purchase.id,
        status: purchase.status,
      });
      return done('already terminal');
    }

    const confirmed = await this.confirmWithProvider({
      purchaseId: purchase.id,
      providerName: purchase.providerName as ProviderNameEnum,
      providerReference: payload.providerReference,
    });

    if (!confirmed) {
      // We could not reach the provider to verify. Acting on the unverified
      // payload is exactly what this design refuses to do, so ask for the
      // retry their schedule exists for.
      return askRetry('status confirmation failed');
    }

    if (confirmed.status === TransactionStatusEnum.PENDING) {
      // The provider told us something happened, then told us nothing has.
      // Do not guess - leave it pending for the settlement sweep.
      this.logger.warn({
        msg: 'QRIS callback fired but the provider still reports PENDING',
        purchaseId: purchase.id,
        providerReference: payload.providerReference,
        callbackStatus: payload.status,
      });
      return done('provider still pending');
    }

    await this.settle(purchase, confirmed, payload);

    return done(`settled as ${confirmed.status}`);
  }

  /**
   * Write the confirmed outcome, then notify the merchant.
   *
   * **Every terminal status is written, not just SUCCESS.** An expired QR that
   * only ever updated on payment would sit PENDING forever, and the whole point
   * of deriving EXPIRED from the provider's `FAILED` is to be able to close
   * those out.
   */
  private async settle(
    purchase: PurchaseRow,
    confirmed: UpstreamQrisStatusResponseDto,
    payload: UpstreamWebhookQrisDto,
  ): Promise<void> {
    const isPaid = confirmed.status === TransactionStatusEnum.SUCCESS;

    // Fees only for money that actually arrived. A QR that expired earns
    // nothing, so writing a breakdown for it would be noise settlement has to
    // filter back out.
    const fee = isPaid
      ? await this.calculateFee({
          merchantId: purchase.merchantId,
          providerName: purchase.providerName as ProviderNameEnum,
          nominal: confirmed.nominal,
        })
      : null;

    const netNominal = fee
      ? new Decimal(fee.merchantFee.netNominal)
      : purchase.nominal;

    await this.prismaMaster.purchaseTransaction.update({
      where: { id: purchase.id },
      data: {
        status: confirmed.status,
        // Null unless the provider says money arrived. Defaulting to "now"
        // would stamp a payment time on a transaction nobody ever paid.
        paidAt: payload.paidAt,
        ...(fee
          ? {
              netNominal,
              feeDetails: { create: this.feeDetails(fee) },
            }
          : {}),
        metadata: this.mergeMetadata(purchase.metadata, {
          ...payload.metadata,
          ...confirmed.metadata,
        }),
      },
    });

    this.logger.log({
      msg: 'QRIS transaction settled from callback',
      purchaseId: purchase.id,
      status: confirmed.status,
      feesWritten: fee !== null,
    });

    if (!isPaid) return;

    if (!fee) {
      // The payment is recorded either way - refusing to record money that
      // moved because a fee service was down would be strictly worse. The
      // settlement sweep re-derives the breakdown for any SUCCESS without one.
      this.logger.error({
        msg: 'Paid QRIS settled with no fee detail - needs the settlement sweep',
        purchaseId: purchase.id,
      });
    }

    await this.notifyMerchant(purchase, confirmed, netNominal, payload.paidAt);

    // TODO(balance-ledger): on SUCCESS, append MerchantBalanceLog /
    // AgentBalanceLog / InternalBalanceLog rows inside one transaction with
    // advisory locks. Blocked on D17 in docs/dashboard-migration.md - the
    // legacy write path has three defects and porting it faithfully would
    // reproduce them. Until that lands, balances are not moved here.
  }

  /**
   * Tell the merchant their payment landed.
   *
   * **Never fatal.** The transaction is already settled at this point, so
   * throwing would make the provider retry a notification we have fully
   * processed - and the retry would exit at the terminal-status guard, so the
   * merchant would never be told at all. A failure here is logged and left for
   * the webhook retry job.
   */
  private async notifyMerchant(
    purchase: PurchaseRow,
    confirmed: UpstreamQrisStatusResponseDto,
    netNominal: Decimal,
    paidAt: Date | null,
  ): Promise<void> {
    try {
      const { payinUrl } =
        await this.merchantSignatureClient.findMerchantWebhookUrl({
          userId: purchase.merchantId,
        });
      if (!payinUrl) return;

      const body: WebhookPayinDto = {
        transactionId: purchase.systemReference,
        merchantReference: purchase.merchantReference,
        amount: { value: purchase.nominal.toFixed(2), currency: 'IDR' },
        netAmount: { value: netNominal.toFixed(2), currency: 'IDR' },
        fee: {
          value: purchase.nominal.minus(netNominal).toFixed(2),
          currency: 'IDR',
        },
        status: confirmed.status,
        // ISO 8601 UTC. `toLocaleString()` here would emit the *server's*
        // locale - "9/2/2026, 4:15:53 PM" - which no merchant can parse
        // reliably and which changes with the host's configuration.
        paidAt: paidAt ? paidAt.toISOString() : null,
      };

      await firstValueFrom(
        this.httpService
          .post<unknown>(payinUrl, body)
          .pipe(timeout(MERCHANT_WEBHOOK_TIMEOUT_MS)),
      );

      this.logger.log({
        msg: 'Merchant payin webhook delivered',
        purchaseId: purchase.id,
        merchantId: purchase.merchantId,
      });
    } catch (error) {
      // TODO(webhook-retry): queue for redelivery with backoff, and expose a
      // manual replay endpoint. Until then a merchant whose endpoint was down
      // has to reconcile from the status query.
      this.logger.error({
        msg: 'Merchant payin webhook failed - transaction IS settled, merchant was not notified',
        purchaseId: purchase.id,
        merchantId: purchase.merchantId,
        error,
      });
    }
  }

  /**
   * Re-read the authoritative status from the provider.
   *
   * Returns null when we could not get an answer, which the caller turns into a
   * retry - never into an assumption.
   */
  private async confirmWithProvider({
    purchaseId,
    providerName,
    providerReference,
  }: {
    purchaseId: number;
    providerName: ProviderNameEnum;
    providerReference: string;
  }): Promise<UpstreamQrisStatusResponseDto | null> {
    try {
      switch (providerName) {
        case ProviderNameEnum.MOTIONPAY:
          // `return await`, not `return`: without the await the promise
          // rejects after this try block has already exited, so the catch
          // below never runs and the error escapes as an unhandled failure.
          return await this.motionPayQrisService.getQrisStatus({
            systemReference: null,
            providerReference,
          });
        default:
          this.logger.error({
            msg: 'No QRIS status client for this provider',
            providerName,
            purchaseId,
          });
          return null;
      }
    } catch (error) {
      this.logger.error({
        msg: 'Could not confirm QRIS status with the provider',
        providerReference,
        purchaseId,
        error,
      });
      return null;
    }
  }

  private async findPurchase(providerReference: string) {
    try {
      return await this.prismaMaster.purchaseTransaction.findUnique({
        where: { providerReference },
        select: {
          id: true,
          systemReference: true,
          merchantReference: true,
          merchantId: true,
          providerName: true,
          status: true,
          nominal: true,
          metadata: true,
        },
      });
    } catch (error) {
      this.logger.error({
        msg: 'Lookup failed while handling a QRIS callback',
        providerReference,
        error,
      });
      return null;
    }
  }

  /**
   * Evidence first, and the **raw** payload - not our normalised copy.
   *
   * The log exists to answer "what did they actually send us" during a dispute,
   * and a shape we rewrote cannot answer that. A failure to record is logged
   * but does not stop settlement: losing the audit copy is bad, failing to
   * record a payment is worse.
   */
  private async recordWebhook(
    purchaseId: number | null,
    payload: UpstreamWebhookQrisDto,
  ): Promise<void> {
    try {
      await this.prismaMaster.webhookLog.create({
        data: {
          transactionId: purchaseId,
          providerReference: payload.providerReference,
          transactionType: this.transactionType,
          source: payload.providerName,
          payload: payload.rawPayload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error({
        msg: 'Could not persist the QRIS callback payload',
        providerReference: payload.providerReference,
        error,
      });
    }
  }

  private async calculateFee({
    merchantId,
    providerName,
    nominal,
  }: {
    merchantId: number;
    providerName: ProviderNameEnum;
    nominal: string;
  }): Promise<FeeCalculationResultDto | null> {
    try {
      return await this.feeCalculateClient.purchase({
        merchantId,
        providerName,
        paymentMethodName: this.paymentMethodName,
        nominal,
      });
    } catch (error) {
      this.logger.error({
        msg: 'Fee calculation failed while settling a paid QRIS',
        merchantId,
        error,
      });
      return null;
    }
  }

  /** One row per party. Agents are itemised rather than collapsed to a total. */
  private feeDetails(
    fee: FeeCalculationResultDto,
  ): Prisma.PurchaseFeeDetailCreateWithoutTransactionInput[] {
    return [
      {
        type: FeeTypeEnum.MERCHANT,
        nominal: new Decimal(fee.merchantFee.nominal),
        feePercentage: new Decimal(fee.merchantFee.feePercentage),
      },
      {
        type: FeeTypeEnum.PROVIDER,
        nominal: new Decimal(fee.providerFee.nominal),
        feeFixed: new Decimal(fee.providerFee.feeFixed),
        feePercentage: new Decimal(fee.providerFee.feePercentage),
      },
      {
        type: FeeTypeEnum.INTERNAL,
        nominal: new Decimal(fee.internalFee.nominal),
        feeFixed: new Decimal(fee.internalFee.feeFixed),
        feePercentage: new Decimal(fee.internalFee.feePercentage),
      },
      ...fee.agentFee.agents.map((agent) => ({
        type: FeeTypeEnum.AGENT,
        agentId: agent.agentId,
        nominal: new Decimal(agent.nominal),
        feePercentage: new Decimal(agent.feePercentage),
      })),
    ];
  }

  /**
   * Merge new evidence into `metadata` without discarding what is there.
   *
   * The column holds one object keyed by event - `{ CREATE_QRIS,
   * CALLBACK_QRIS, STATUS_QRIS }` - so each stage keeps its own payload. A
   * plain assignment would let the callback erase the create response, which is
   * half of what a disputed payment is argued from.
   */
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

type PurchaseRow = {
  id: number;
  systemReference: string;
  merchantReference: string;
  merchantId: number;
  providerName: string;
  status: string;
  nominal: Decimal;
  metadata: Prisma.JsonValue;
};
