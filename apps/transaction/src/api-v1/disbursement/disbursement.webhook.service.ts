import {
  MerchantSignatureAuthClient,
  TransactionStatusEnum,
  TransactionTypeEnum,
} from '@app/microservice';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import { UpstreamWebhookTransferDto } from '@app/upstream';
import { HttpService } from '@nestjs/axios';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@transaction/prisma';
import Decimal from 'decimal.js';
import { firstValueFrom, timeout } from 'rxjs';
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

    const settled = await this.settle(disbursement, payload);

    return done(
      settled
        ? `settled as ${payload.status}`
        : `recorded as ${payload.status}, not terminal`,
    );
  }

  /**
   * Write the confirmed outcome, then notify the merchant.
   *
   * Every terminal status is written, not only SUCCESS - a rejected payout that
   * stayed PENDING would never release the merchant's funds or show up as
   * needing attention.
   *
   * **A non-terminal callback writes the status and nothing else.** That
   * sentence above used to be the intent and not the behaviour: `isPaid` was
   * `status === SUCCESS`, so anything else - `PENDING` included - took the
   * failed branch and handed the reservation back. Found on 20 Nov 2026 by the
   * payout cron, four minutes after it was first switched on.
   *
   * It was safe while MotionPay was the only payout provider, because every
   * status its callback could carry was terminal. Jatelindo breaks that on
   * purpose: `A01`, `E99` and `E18` are the codes its spec marks
   * `Need Check = Y`, and `jatelindoMapperResponseCode` maps them to `PENDING`
   * precisely because the provider is saying *it cannot confirm the outcome*.
   *
   * Releasing on those is the worst available answer. The transfer may still
   * complete, so the merchant gets their money back as spendable `AVAILABLE`
   * while the beneficiary is paid - the loss the response-code table exists to
   * prevent. It also leaves the row `PENDING`, so a later terminal callback
   * passes the guard above and posts `PAYOUT_COMPLETED`, debiting a `RESERVED`
   * bucket that no longer holds the money; nothing in `applyToSnapshot` or on
   * `BalanceSnapshot` stops that going negative.
   *
   * So the reservation stays held until something terminal arrives. Held funds
   * are recoverable - `2427cc7` is the matching lesson from the other
   * direction, where a terminal row left its reservation stranded.
   *
   * @returns whether this callback settled the payout.
   */
  private async settle(
    disbursement: DisbursementRow,
    // confirmed: UpstreamTransferStatusResponseDto,
    payload: UpstreamWebhookTransferDto,
  ): Promise<boolean> {
    const isTerminal = TERMINAL_STATUSES.includes(payload.status);
    const isPaid = payload.status === TransactionStatusEnum.SUCCESS;

    // The provider's callback has no timestamp of its own, so the moment we
    // confirmed settlement is the best record we have of when it happened.
    const paidAt = isPaid ? new Date() : null;

    await this.prismaMaster.$transaction(async (tx) => {
      await tx.disbursementTransaction.update({
        where: { id: disbursement.id },
        data: {
          status: payload.status,
          paidAt,
          providerReference: payload.providerReference,
          metadata: this.mergeMetadata(disbursement.metadata, {
            ...payload.metadata,
            // ...confirmed.metadata,
          }),
        },
      });
      // The one branch that must not be taken on a non-terminal status: this
      // is what releases or consumes the reservation.
      if (!isTerminal) return;

      await this.common.postPayoutOutcome(tx, {
        disbursementId: disbursement.id,
        merchantId: disbursement.merchantId,
        netNominal: disbursement.netNominal,
        isPaid,
      });
    });

    if (!isTerminal) {
      // Warn rather than log: the provider has told us it does not know what
      // happened to real money, and the payout now needs either a later
      // callback or a person.
      this.logger.warn({
        msg: 'Payout callback is not terminal; reservation stays held',
        disbursementId: disbursement.id,
        merchantId: disbursement.merchantId,
        status: payload.status,
        providerReference: payload.providerReference,
      });

      return false;
    }

    this.logger.log({
      msg: 'Payout settled from callback',
      disbursementId: disbursement.id,
      status: payload.status,
    });

    await this.notifyMerchant(
      disbursement,
      disbursement.netNominal,
      paidAt,
      payload.status,
    );

    return true;
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
    netNominal: Decimal,
    paidAt: Date | null,
    status: TransactionStatusEnum,
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
        status: status,
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
