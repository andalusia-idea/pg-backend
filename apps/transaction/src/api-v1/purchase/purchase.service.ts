import {
  FeeCalculateConfigClient,
  FeeCalculationResultDto,
  PaymentMethodNameEnum,
  ProfileClient,
  ProviderNameEnum,
  TransactionException,
  TransactionStatusEnum,
  TransactionTypeEnum,
  UserRoleEnum,
} from '@app/microservice';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import {
  PurchaseUpstreamRequestDto,
  PurchaseUpstreamResponseDto,
  UpstreamException,
} from '@app/upstream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { FeeTypeEnum, Prisma, PrismaClient } from '@transaction/prisma';
import Decimal from 'decimal.js';
import { MotionPayQRISService } from '../../upstream/motionpay';
import { generateSystemReference } from '../transaction.helper';
import { CreateQrisDataDto, CreateQrisRequestDto } from './purchase.dto';

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class PurchaseService {
  private readonly logger = new Logger(PurchaseService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,

    private readonly feeCalculateClient: FeeCalculateConfigClient,
    private readonly profileClient: ProfileClient,

    private readonly motionPayQrisService: MotionPayQRISService,
  ) {}

  private readonly userRole = UserRoleEnum.MERCHANT;
  private readonly transactionType = TransactionTypeEnum.PURCHASE;
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
  async createQRIS(
    userId: number,
    dto: CreateQrisRequestDto,
  ): Promise<CreateQrisDataDto> {
    const providerName = await this.resolveProvider(userId);
    const fee = await this.calculateFee(userId, providerName, dto.amount.value);

    const systemReference = generateSystemReference({
      userId,
      transactionType: this.transactionType,
      paymentMethodName: this.paymentMethodName,
      providerName,
      length: 64,
    });

    const purchaseId = await this.reserveTransaction(
      userId,
      providerName,
      systemReference,
      dto,
      fee,
    );

    const upstream = await this.callProvider(purchaseId, {
      systemReference,
      userId,
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
   * Which provider this merchant routes QRIS pay-ins to.
   *
   * A merchant with no fee configuration for QRIS/PURCHASE gets a 403, not a
   * 500: they are authenticated and their request is well-formed, we simply
   * have not enabled the product for them. That is an onboarding gap someone
   * on our side has to close, and saying so is more useful than a generic
   * error that sends them to re-read their signing code.
   */
  private async resolveProvider(userId: number): Promise<ProviderNameEnum> {
    try {
      const profile = await this.profileClient.findProfileProvider({
        userId,
        userRole: this.userRole,
        paymentMethodName: this.paymentMethodName,
        transactionType: this.transactionType,
      });
      return profile.providerName;
    } catch (error) {
      // config answers "no such fee row" by throwing, and over TCP that arrives
      // as an opaque error rather than a Prisma code - so we can only separate
      // the two cases by whether the transport itself failed.
      if (this.isTransportFailure(error)) {
        this.logger.error({
          msg: 'Config service unreachable while resolving provider',
          userId,
          error,
        });
        throw TransactionException.serviceUnavailable();
      }

      this.logger.warn({
        msg: 'No provider routing configured for merchant',
        userId,
        paymentMethodName: this.paymentMethodName,
        transactionType: this.transactionType,
        error,
      });
      throw TransactionException.transactionNotPermitted();
    }
  }

  /**
   * Split the nominal into merchant / agent / provider / internal cuts.
   *
   * Runs before the provider is called, not after, because it can fail - and a
   * fee failure after a QR exists upstream leaves a payable QR whose economics
   * were never computed.
   */
  private async calculateFee(
    userId: number,
    providerName: ProviderNameEnum,
    nominal: string,
  ): Promise<FeeCalculationResultDto> {
    try {
      return await this.feeCalculateClient.purchase({
        merchantId: userId,
        providerName,
        paymentMethodName: this.paymentMethodName,
        nominal,
      });
    } catch (error) {
      this.logger.error({
        msg: 'Fee calculation failed',
        userId,
        providerName,
        nominal,
        error,
      });
      throw TransactionException.serviceUnavailable();
    }
  }

  /**
   * Claim `merchantReference` and write the transaction with its fee breakdown.
   *
   * `providerReference` and `expiresAt` are left null: we genuinely do not know
   * them yet, and inventing placeholders would put values in the database that
   * later have to be told apart from real ones.
   *
   * The fee rows are created in the same statement as the purchase, so they
   * share its transaction. A purchase whose fee detail is missing cannot be
   * settled correctly, so the two must land together or not at all.
   */
  private async reserveTransaction(
    userId: number,
    providerName: ProviderNameEnum,
    systemReference: string,
    dto: CreateQrisRequestDto,
    fee: FeeCalculationResultDto,
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
          netNominal: new Decimal(fee.merchantFee.netNominal),

          status: TransactionStatusEnum.PENDING,

          feeDetails: { create: this.feeDetails(fee) },
        },
        select: { id: true },
      });
      return purchase.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        const target = (error.meta?.target as string[] | undefined) ?? [];

        // A systemReference collision is ours, not theirs - our generator
        // produced a value we already hold. Vanishingly unlikely, and a 409
        // blaming the merchant would send them hunting a bug in their code.
        if (target.includes('systemReference')) {
          this.logger.error({
            msg: 'systemReference collision',
            systemReference,
          });
          throw TransactionException.internalError();
        }

        this.logger.debug({
          msg: 'Duplicate merchantReference',
          userId,
          merchantReference: dto.merchantReference,
        });
        throw TransactionException.duplicateMerchantReference(
          dto.merchantReference,
        );
      }

      this.logger.error({
        msg: 'Failed to reserve purchase transaction',
        userId,
        systemReference,
        error,
      });
      throw TransactionException.serviceUnavailable();
    }
  }

  /** Flatten the fee calculation into one row per party. */
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
      // One row per agent rather than a single AGENT total: the shareholder
      // split is what settlement pays out against, and collapsing it here would
      // mean recomputing it at settlement time from a configuration that may
      // since have changed.
      ...fee.agentFee.agents.map((agent) => ({
        type: FeeTypeEnum.AGENT,
        agentId: agent.agentId,
        nominal: new Decimal(agent.nominal),
        feePercentage: new Decimal(agent.feePercentage),
      })),
    ];
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
  private async callProvider(
    purchaseId: number,
    dto: PurchaseUpstreamRequestDto,
  ): Promise<PurchaseUpstreamResponseDto> {
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
        await this.markFailed(purchaseId, { reason: 'no client for provider' });
        throw error;
      }

      const timedOut = this.isTransportFailure(error);
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

      await this.markFailed(
        purchaseId,
        error instanceof UpstreamException
          ? {
              provider: error.provider,
              message: error.message,
              ...error.context,
            }
          : { message: 'unknown upstream failure' },
      );
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
    upstream: PurchaseUpstreamResponseDto,
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

  /** Best-effort: the merchant is being told this failed either way. */
  private async markFailed(
    purchaseId: number,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prismaMaster.purchaseTransaction.update({
        where: { id: purchaseId },
        data: {
          status: TransactionStatusEnum.FAILED,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error({
        msg: 'Could not mark purchase FAILED',
        purchaseId,
        error,
      });
    }
  }

  /**
   * Whether an error is "we could not complete the call" rather than "the call
   * completed and the answer was no".
   *
   * The distinction decides between 503/504 (retry, we may be fine next time)
   * and a 4xx (do not retry this unchanged), so it earns more than a catch-all.
   * rxjs surfaces a TCP timeout as `TimeoutError`; axios uses
   * `ECONNABORTED`/`ETIMEDOUT` and leaves `response` undefined when nothing
   * came back at all.
   */
  private isTransportFailure(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;

    const candidate = error as {
      name?: string;
      code?: string;
      context?: { status?: number };
    };

    if (candidate.name === 'TimeoutError') return true;
    if (
      candidate.code === 'ECONNABORTED' ||
      candidate.code === 'ETIMEDOUT' ||
      candidate.code === 'ECONNREFUSED'
    ) {
      return true;
    }

    // An UpstreamException with no HTTP status means the request never got an
    // answer; one carrying a status means the provider replied and refused.
    if (error instanceof UpstreamException) {
      return candidate.context?.status === undefined;
    }

    return false;
  }
}
