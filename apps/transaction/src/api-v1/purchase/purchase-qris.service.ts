import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionException,
  TransactionStatusEnum,
} from '@app/microservice';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import {
  UpstreamException,
  UpstreamQrisRequestDto,
  UpstreamQrisResponseDto,
} from '@app/upstream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@transaction/prisma';
import Decimal from 'decimal.js';
import {
  MOTIONPAY_METADATA_KEY,
  MotionPayQrisService,
} from '../../upstream/motionpay';
import {
  DEFAULT_SYSTEM_REFERENCE_LENGTH,
  generateSystemReference,
} from '../transaction.helper';
import { PurchaseCommonService } from './purchase-common.service';
import { CreateQrisDataDto, CreateQrisRequestDto } from './purchase.dto';

/**
 * Pay-in by dynamic QRIS.
 *
 * What it shares with any other pay-in instrument lives in
 * `PurchaseCommonService`; what is specific to presenting a customer with a QR
 * code - and to the fact that QR codes expire - is here.
 */
@Injectable()
export class PurchaseQrisService {
  private readonly logger = new Logger(PurchaseQrisService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,

    private readonly common: PurchaseCommonService,
    private readonly motionPayQrisService: MotionPayQrisService,
  ) {}

  private readonly paymentMethodName = PaymentMethodNameEnum.QRIS;

  /**
   * Create a dynamic QRIS for a merchant.
   *
   * **The ordering here is the whole design, so it is worth stating plainly.**
   * The row is written to our database *before* the provider is called, and
   * updated after. The obvious alternative - call the provider, then record
   * what came back - has a failure mode that costs real money: if the insert
   * fails after the QR exists upstream, a customer can scan and pay a QR we
   * have no record of. Nothing reconciles it and nobody is billed correctly.
   *
   * Writing first inverts that. The worst case becomes a PENDING row with no
   * QR, which is visible, queryable and harmless - reconciliation resolves it
   * against the provider. We would rather explain a transaction that does not
   * exist than lose one that does.
   *
   * It also makes idempotency free. `@@unique([merchantId, merchantReference])`
   * is claimed by the insert itself, so a merchant retrying the same reference
   * is rejected atomically. A read-then-write check would let two concurrent
   * retries both pass the check and both create a QR upstream.
   */
  async createPurchase(
    userId: number,
    dto: CreateQrisRequestDto,
  ): Promise<CreateQrisDataDto> {
    const providerName = await this.common.resolveProvider(
      userId,
      this.paymentMethodName,
    );

    const systemReference = generateSystemReference({
      userId,
      transactionType: this.common.transactionType,
      paymentMethodName: this.paymentMethodName,
      providerName,
      maxLength: this.systemReferenceMaxLength(providerName),
    });

    const purchaseId = await this.reserveTransaction(
      userId,
      providerName,
      systemReference,
      dto,
    );

    const upstream = await this.callUpstream(purchaseId, {
      systemReference,
      providerName,
      merchantReference: dto.merchantReference,
      amount: dto.amount,
      expireSeconds: dto.expireSeconds,
    });

    await this.recordUpstreamResult(purchaseId, upstream);

    return {
      transactionId: systemReference,
      merchantReference: dto.merchantReference,
      status: upstream.status,
      qr: {
        qrString: upstream.qrString,
        expiresAt: upstream.expiresAt,
      },
    };
  }

  /**
   * Ask the routed provider how long a reference it can carry, before one is
   * generated.
   *
   * Deciding this up front rather than after the call is the point: the
   * reference is the key every callback is matched on, so it has to be right in
   * the row's very first write and never change afterwards. Adjusting it later
   * would mean doing so in `recordUpstreamResult`, which deliberately swallows
   * its errors — a lost update there would leave the row permanently
   * unmatchable instead of merely missing some decoration.
   */
  private systemReferenceMaxLength(providerName: ProviderNameEnum): number {
    switch (providerName) {
      case ProviderNameEnum.MOTIONPAY:
        return this.motionPayQrisService.systemReferenceMaxLength;
      default:
        // Routing sent us somewhere we have no client for. `callUpstream` is
        // where that gets reported properly; all we need here is a length that
        // cannot produce an over-long reference, and our own default is it.
        return DEFAULT_SYSTEM_REFERENCE_LENGTH;
    }
  }

  /**
   * Claim `merchantReference` and write the transaction.
   *
   * `providerReference` and `expiresAt` are left null: we genuinely do not know
   * them yet, and inventing placeholders would put values in the database that
   * later have to be told apart from real ones.
   *
   * **No fee breakdown is written here.** Fees are calculated when the payment
   * is confirmed by callback, not when the QR is issued: a QR that expires
   * never earns anything, so computing at creation writes rows for transactions
   * that will never settle. `netNominal` stays at its `0.00` default until then
   * - unambiguous while the row is PENDING, since a pending purchase has earned
   * nothing yet by definition.
   */
  private async reserveTransaction(
    userId: number,
    providerName: ProviderNameEnum,
    systemReference: string,
    dto: CreateQrisRequestDto,
  ): Promise<number> {
    try {
      const purchase = await this.prismaMaster.purchaseTransaction.create({
        data: {
          merchantId: userId,
          systemReference,
          merchantReference: dto.merchantReference,

          providerName,
          paymentMethodName: this.paymentMethodName,
          nominal: new Decimal(dto.amount.value),

          status: TransactionStatusEnum.PENDING,
        },
        select: { id: true },
      });
      return purchase.id;
    } catch (error) {
      this.common.reserveFailure({
        error,
        userId,
        systemReference,
        merchantReference: dto.merchantReference,
        instrument: 'QRIS',
      });
    }
  }

  /**
   * Call the routed provider, translating any failure into a merchant-facing
   * one and leaving the reserved row in an honest state.
   *
   * A **timeout is deliberately not marked FAILED.** We do not know whether the
   * QR was created - the request may have succeeded with only the response
   * lost. Marking it FAILED asserts something unknown, and if a customer then
   * pays that QR we hold a paid transaction we told everyone had failed. It
   * stays PENDING for reconciliation to settle.
   */
  private async callUpstream(
    purchaseId: number,
    dto: UpstreamQrisRequestDto,
  ): Promise<UpstreamQrisResponseDto> {
    try {
      switch (dto.providerName) {
        case ProviderNameEnum.MOTIONPAY:
          return await this.motionPayQrisService.createQRIS(dto);
        default:
          // Routing sent us somewhere we have no client for: a configuration
          // error of ours, so the merchant gets a 500 and we get the log.
          this.logger.error({
            msg: 'No QRIS client for routed provider',
            providerName: dto.providerName,
            systemReference: dto.systemReference,
          });
          throw TransactionException.internalError();
      }
    } catch (error) {
      if (error instanceof TransactionException) {
        await this.common.markFailed(purchaseId, {
          [MOTIONPAY_METADATA_KEY.CREATE_QRIS_ERROR]: {
            reason: 'no client for provider',
          },
        });
        throw error;
      }

      const timedOut = this.common.isTransportFailure(error);
      this.logger.error({
        msg: 'Upstream QRIS creation failed',
        purchaseId,
        systemReference: dto.systemReference,
        providerName: dto.providerName,
        timedOut,
        context: error instanceof UpstreamException ? error.context : undefined,
        error,
      });

      if (timedOut) throw TransactionException.upstreamTimeout();

      await this.common.markFailed(purchaseId, {
        [MOTIONPAY_METADATA_KEY.CREATE_QRIS_ERROR]:
          error instanceof UpstreamException
            ? {
                provider: error.provider,
                message: error.message,
                ...error.context,
              }
            : { message: 'unknown upstream failure' },
      });
      throw TransactionException.upstreamRejected();
    }
  }

  /**
   * Attach what the provider returned to the reserved row.
   *
   * A failure here is logged but **not** raised: the QR exists and is payable,
   * so answering the merchant with an error would tell them to retry and create
   * a second QR for the same order. The row is already PENDING under the right
   * reference, and reconciliation can repair the missing detail.
   */
  private async recordUpstreamResult(
    purchaseId: number,
    upstream: UpstreamQrisResponseDto,
  ): Promise<void> {
    try {
      await this.prismaMaster.purchaseTransaction.update({
        where: { id: purchaseId },
        data: {
          providerReference: upstream.providerReference,
          status: upstream.status,
          expiresAt: new Date(upstream.expiresAt),
          metadata: upstream.metadata as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error({
        msg: 'QR created upstream but the transaction could not be updated - needs reconciliation',
        purchaseId,
        providerReference: upstream.providerReference,
        error,
      });
    }
  }
}
