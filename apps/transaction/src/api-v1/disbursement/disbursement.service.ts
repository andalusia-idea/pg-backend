import {
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
  UpstreamException,
  UpstreamTransferInquiryResponseDto,
  UpstreamTransferRequestDto,
  UpstreamTransferResponseDto,
} from '@app/upstream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@transaction/prisma';
import Decimal from 'decimal.js';
import {
  MOTIONPAY_METADATA_KEY,
  MotionPayTransferService,
} from '../../upstream/motionpay';
import { generateSystemReference } from '../transaction.helper';
import {
  CreateTransferDataDto,
  CreateTransferRequestDto,
} from './disbursement.dto';

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class DisbursementService {
  private readonly logger = new Logger(DisbursementService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,

    private readonly profileClient: ProfileClient,
    private readonly motionPayTransferService: MotionPayTransferService,
  ) {}

  private readonly userRole = UserRoleEnum.MERCHANT;
  private readonly transactionType = TransactionTypeEnum.DISBURSEMENT;
  private readonly paymentMethodName = PaymentMethodNameEnum.TRANSFERBANK;

  /**
   * Send a bank payout on a merchant's behalf.
   *
   * Same reserve-before-call ordering as the pay-in flow, and for the same
   * reason: the database row is written before the provider is asked to move
   * anything, so we can never have money in flight that we have no record of.
   *
   * **With one step the pay-in flow does not have.** The beneficiary is
   * verified with the bank *before* the row is reserved. Payouts are the
   * asymmetric case - a failed pay-in can be retried, money sent to a mistyped
   * account number is gone. One extra round trip converts an unrecoverable loss
   * into a `4009103`.
   *
   * Idempotency is claimed by the insert, via
   * `@@unique([merchantId, merchantReference])`. A merchant retrying the same
   * reference is rejected atomically, which for a payout is the difference
   * between paying a recipient once and paying them twice.
   */
  async createTransfer(
    userId: number,
    dto: CreateTransferRequestDto,
  ): Promise<CreateTransferDataDto> {
    const providerName = await this.resolveProvider(userId);

    const systemReference = generateSystemReference({
      userId,
      transactionType: this.transactionType,
      paymentMethodName: this.paymentMethodName,
      providerName,
      length: 32,
    });

    const beneficiary = await this.verifyBeneficiary({
      systemReference,
      providerName,
      bankCode: dto.bankCode,
      accountNumber: dto.accountNumber,
    });

    const disbursementId = await this.reserveTransaction({
      userId,
      providerName,
      systemReference,
      dto,
      beneficiary,
    });

    const upstream = await this.callUpstream(disbursementId, {
      systemReference,
      providerName,
      merchantReference: dto.merchantReference,
      amount: dto.amount,
      bankCode: dto.bankCode,
      accountNumber: dto.accountNumber,
      // The bank's spelling, not the merchant's.
      accountHolderName: beneficiary.accountHolderName,
      note: dto.note ?? dto.merchantReference,
    });

    await this.recordUpstreamResult(disbursementId, upstream);

    return {
      transactionId: systemReference,
      merchantReference: dto.merchantReference,
      status: upstream.status,
      beneficiary: {
        bankCode: beneficiary.bankCode,
        accountNumber: beneficiary.accountNumber,
        accountHolderName: beneficiary.accountHolderName,
      },
    };
  }

  /**
   * Which provider this merchant routes bank payouts through.
   *
   * A merchant with no fee configuration for TRANSFERBANK/DISBURSEMENT gets a
   * 403, not a 500: they are authenticated and their request is well-formed, we
   * simply have not enabled the product for them.
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
   * Ask the bank whether the account exists, before anything is written.
   *
   * A failed lookup is a **business outcome, not an exception** - the provider
   * answers HTTP 200 with `valid: false` and an empty name. Relying on an
   * absent throw here would send money to unverified accounts.
   */
  private async verifyBeneficiary(params: {
    systemReference: string;
    providerName: ProviderNameEnum;
    bankCode: string;
    accountNumber: string;
  }): Promise<UpstreamTransferInquiryResponseDto> {
    let inquiry: UpstreamTransferInquiryResponseDto;

    try {
      switch (params.providerName) {
        case ProviderNameEnum.MOTIONPAY:
          inquiry = await this.motionPayTransferService.accountInquiry(params);
          break;
        default:
          this.logger.error({
            msg: 'No transfer client for routed provider',
            providerName: params.providerName,
            systemReference: params.systemReference,
          });
          throw TransactionException.internalError();
      }
    } catch (error) {
      if (error instanceof TransactionException) throw error;
      throw this.toMerchantFailure(error, params.systemReference, 'inquiry');
    }

    if (!inquiry.valid) {
      this.logger.debug({
        msg: 'Beneficiary account did not resolve',
        systemReference: params.systemReference,
        bankCode: params.bankCode,
        message: inquiry.message,
      });
      throw TransactionException.invalidBeneficiary(
        `${params.bankCode}/${params.accountNumber}`,
      );
    }

    return inquiry;
  }

  /**
   * Claim `merchantReference` and write the payout before it is sent.
   *
   * `providerReference` is left null - we do not have it until the provider
   * answers. No fee breakdown is written either: fees are computed when the
   * payout is confirmed settled, so a rejected transfer never leaves fee rows
   * behind for money that never moved.
   */
  private async reserveTransaction({
    userId,
    providerName,
    systemReference,
    dto,
    beneficiary,
  }: {
    userId: number;
    providerName: ProviderNameEnum;
    systemReference: string;
    dto: CreateTransferRequestDto;
    beneficiary: UpstreamTransferInquiryResponseDto;
  }): Promise<number> {
    try {
      const row = await this.prismaMaster.disbursementTransaction.create({
        data: {
          merchantId: userId,
          systemReference,
          merchantReference: dto.merchantReference,

          recipientName: beneficiary.accountHolderName,
          recipientAccount: beneficiary.accountNumber,
          recipientBankCode: beneficiary.bankCode,

          providerName,
          paymentMethodName: this.paymentMethodName,
          nominal: new Decimal(dto.amount.value),

          status: TransactionStatusEnum.PENDING,
        },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        const target = (error.meta?.target as string[] | undefined) ?? [];

        if (target.includes('systemReference')) {
          this.logger.error({
            msg: 'systemReference collision',
            systemReference,
          });
          throw TransactionException.internalError();
        }

        // For a payout this guard is doing more work than its pay-in twin:
        // without it, a retried request pays the recipient a second time.
        this.logger.debug({
          msg: 'Duplicate merchantReference on payout',
          userId,
          merchantReference: dto.merchantReference,
        });
        throw TransactionException.duplicateMerchantReference(
          dto.merchantReference,
        );
      }

      this.logger.error({
        msg: 'Failed to reserve disbursement transaction',
        userId,
        systemReference,
        error,
      });
      throw TransactionException.serviceUnavailable();
    }
  }

  /**
   * Send the payout.
   *
   * A **timeout is deliberately not marked FAILED.** We do not know whether the
   * money left. Marking it failed asserts something unknown, and if it did
   * leave, we would have told the merchant their payout failed while the
   * recipient was paid. It stays PENDING for the status poll to resolve.
   */
  private async callUpstream(
    disbursementId: number,
    dto: UpstreamTransferRequestDto,
  ): Promise<UpstreamTransferResponseDto> {
    try {
      switch (dto.providerName) {
        case ProviderNameEnum.MOTIONPAY:
          return await this.motionPayTransferService.fundTransfer(dto);
        default:
          this.logger.error({
            msg: 'No transfer client for routed provider',
            providerName: dto.providerName,
            systemReference: dto.systemReference,
          });
          throw TransactionException.internalError();
      }
    } catch (error) {
      if (error instanceof TransactionException) {
        await this.markFailed(disbursementId, {
          [MOTIONPAY_METADATA_KEY.CREATE_TRANSFER_ERROR]: {
            reason: 'no client for provider',
          },
        });
        throw error;
      }

      const timedOut = this.isTransportFailure(error);
      this.logger.error({
        msg: 'Upstream fund transfer failed',
        disbursementId,
        systemReference: dto.systemReference,
        providerName: dto.providerName,
        timedOut,
        context: error instanceof UpstreamException ? error.context : undefined,
        error,
      });

      if (timedOut) throw TransactionException.upstreamTimeout();

      await this.markFailed(disbursementId, {
        [MOTIONPAY_METADATA_KEY.CREATE_TRANSFER_ERROR]:
          error instanceof UpstreamException
            ? {
                provider: error.provider,
                message: error.message,
                ...error.context,
              }
            : { message: 'unknown upstream failure' },
      });

      throw this.toMerchantFailure(error, dto.systemReference, 'fundTransfer');
    }
  }

  /** Attach what the provider returned to the reserved row. */
  private async recordUpstreamResult(
    disbursementId: number,
    upstream: UpstreamTransferResponseDto,
  ): Promise<void> {
    try {
      await this.prismaMaster.disbursementTransaction.update({
        where: { id: disbursementId },
        data: {
          providerReference: upstream.providerReference || null,
          status: upstream.status,
          metadata: upstream.metadata as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Not raised: the payout is already in flight. Telling the merchant it
      // failed would invite a retry that pays the recipient twice.
      this.logger.error({
        msg: 'Payout sent but the transaction could not be updated - needs reconciliation',
        disbursementId,
        providerReference: upstream.providerReference,
        error,
      });
    }
  }

  /** Best-effort: the merchant is being told this failed either way. */
  private async markFailed(
    disbursementId: number,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prismaMaster.disbursementTransaction.update({
        where: { id: disbursementId },
        data: {
          status: TransactionStatusEnum.FAILED,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error({
        msg: 'Could not mark disbursement FAILED',
        disbursementId,
        error,
      });
    }
  }

  /**
   * Translate an upstream rejection into something the merchant can act on.
   *
   * Most provider refusals are opaque and become a 502. Two are worth naming,
   * because the merchant's next move differs: a bad bank code is their payload
   * to fix, and a short deposit is ours - and telling them to retry into an
   * empty float would just burn their time.
   */
  private toMerchantFailure(
    error: unknown,
    systemReference: string,
    stage: string,
  ): TransactionException {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);

    if (message.includes('bank code') || message.includes('recipient_bank')) {
      return TransactionException.unsupportedBankCode();
    }

    if (
      message.includes('insufficient') ||
      message.includes('saldo') ||
      message.includes('deposit')
    ) {
      this.logger.error({
        msg: 'Provider reports our deposit is insufficient to fund payouts',
        systemReference,
        stage,
      });
      return TransactionException.insufficientDeposit();
    }

    return TransactionException.upstreamRejected();
  }

  /**
   * Whether an error is "we could not complete the call" rather than "the call
   * completed and the answer was no".
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

    if (error instanceof UpstreamException) {
      return candidate.context?.status === undefined;
    }

    return false;
  }
}
