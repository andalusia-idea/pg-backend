import {
  isEwalletEnum,
  PaymentMethodNameEnum,
  ProfileClient,
  ProviderNameEnum,
  TransactionException,
  TransactionStatusEnum,
  TransactionTypeEnum,
  UserRoleEnum,
} from '@app/microservice';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import { UpstreamException } from '@app/upstream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@transaction/prisma';
import {
  MotionPayBillerService,
  MotionPayTransferService,
} from '../../upstream/motionpay';
import { DEFAULT_SYSTEM_REFERENCE_LENGTH } from '../transaction.helper';
import { CreateTransferRequestDto } from './disbursement.dto';
import Decimal from 'decimal.js';

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * What a disbursement means, independent of which rail carries it.
 *
 * **Not a facade** - there is no `createTransfer` here. The rails own their own
 * entry points (`DisbursementBankService`, `DisbursementEWalletService`); this
 * holds the decisions they must agree on.
 *
 * The rails differ in how a destination is addressed and how many upstream calls
 * it takes to reach it. They do **not** differ in how a merchant is routed, how
 * a reservation conflict is reported, or what an unreachable provider means -
 * and those are precisely the things that must not drift apart between two paths
 * paying out the same money. A copy that only got fixed on one side is how a
 * bank payout and a wallet payout start answering differently to the same
 * mistake.
 */
@Injectable()
export class DisbursementCommonService {
  private readonly logger = new Logger(DisbursementCommonService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    private readonly profileClient: ProfileClient,

    private readonly motionPayTransferService: MotionPayTransferService,
    private readonly motionPayBillerService: MotionPayBillerService,
  ) {}

  readonly userRole = UserRoleEnum.MERCHANT;
  readonly transactionType = TransactionTypeEnum.DISBURSEMENT;

  /**
   * Ask the rail that will actually carry this payout how long a reference it
   * can hold, before one is generated.
   *
   * **The payment method is load-bearing here, not decoration.** The two
   * MotionPay rails have different budgets, and they are not close: Transfer
   * allows 50 characters, Biller 64 less the `-P` payment suffix, so 62.
   * Answering with Biller's number for a bank payout produces a reference the
   * Transfer endpoint refuses - and since `external_id` is also the key the
   * status endpoint is queried by, a reference that will not fit has to be
   * caught here, before the row is reserved, rather than at the provider.
   *
   * Biller's own getter already subtracts the suffix, so a reference that clears
   * the inquiry cannot overflow the payment leg that follows - the leg where a
   * deposit is actually debited.
   *
   * An unroutable combination gets the house default rather than a throw: the
   * inquiry reports a missing client properly, and this only has to avoid
   * generating something unusable in the meantime.
   */
  systemReferenceMaxLength(
    providerName: ProviderNameEnum,
    paymentMethodName: PaymentMethodNameEnum,
  ): number {
    if (ProviderNameEnum.MOTIONPAY === providerName) {
      if (PaymentMethodNameEnum.TRANSFERBANK === paymentMethodName) {
        return this.motionPayTransferService.systemReferenceMaxLength;
      }
      if (PaymentMethodNameEnum.TRANSFEREWALLET === paymentMethodName) {
        return this.motionPayBillerService.systemReferenceMaxLength;
      }
    }

    return DEFAULT_SYSTEM_REFERENCE_LENGTH;
  }

  /**
   * Which provider this merchant routes a payout through.
   *
   * **The payment method is the routing decision.** `TRANSFERBANK` goes out over
   * the provider's transfer rails; `TRANSFEREWALLET` over their bill-payment
   * rails, which reach the same wallets for materially less. No separate
   * "channel" concept is needed - `BaseFee` is already keyed on payment method,
   * so the price difference that justifies the second rail is modelled exactly
   * where prices live.
   *
   * A merchant with no fee configuration for that pairing gets a 403, not a
   * 500: they are authenticated and their request is well-formed, we simply have
   * not enabled the product for them.
   */
  async resolveProvider(
    userId: number,
    paymentMethodName: PaymentMethodNameEnum,
  ): Promise<ProviderNameEnum> {
    try {
      const profile = await this.profileClient.findProfileProvider({
        userId,
        userRole: this.userRole,
        paymentMethodName,
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
        paymentMethodName,
        transactionType: this.transactionType,
        error,
      });
      throw TransactionException.transactionNotPermitted();
    }
  }

  async reserveTransaction({
    userId,
    systemReference,
    providerName,
    paymentMethodName,
    dto,
  }: {
    userId: number;
    systemReference: string;
    providerName: ProviderNameEnum;
    paymentMethodName: PaymentMethodNameEnum;
    dto: CreateTransferRequestDto;
  }): Promise<number> {
    try {
      const row = await this.prismaMaster.disbursementTransaction.create({
        data: {
          merchantId: userId,
          systemReference,
          merchantReference: dto.merchantReference,

          accountHolderName: '',
          accountNumber: dto.accountNumber,
          bankCode: dto.bankCode,

          providerName,
          paymentMethodName: paymentMethodName,
          nominal: new Decimal(dto.amount.value),

          status: TransactionStatusEnum.PENDING,
        },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      this.reserveFailure({
        error,
        userId,
        systemReference,
        merchantReference: dto.merchantReference,
        rail: paymentMethodName,
      });
    }
  }

  decidePaymentMethodName(bankCode: string) {
    /// TODO refer to microservices.enum.ts PaymentMethodNameEnum
    if (isEwalletEnum(bankCode)) return PaymentMethodNameEnum.TRANSFEREWALLET;
    return PaymentMethodNameEnum.TRANSFERBANK;
  }

  /**
   * Turn a failed reservation into the right merchant-facing error.
   *
   * Always throws. Split out because the distinction it draws matters more for a
   * payout than anywhere else: a duplicate `merchantReference` is the guard that
   * stops a retried request paying the recipient a second time, while a
   * `systemReference` collision is our generator's fault and blaming the
   * merchant would send them hunting a bug in their own code.
   */
  reserveFailure({
    error,
    userId,
    systemReference,
    merchantReference,
    rail,
  }: {
    error: unknown;
    userId: number;
    systemReference: string;
    merchantReference: string;
    rail: string;
  }): never {
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

      this.logger.debug({
        msg: `Duplicate merchantReference on ${rail} payout`,
        userId,
        merchantReference,
      });
      throw TransactionException.duplicateMerchantReference(merchantReference);
    }

    this.logger.error({
      msg: `Failed to reserve ${rail} disbursement`,
      userId,
      systemReference,
      error,
    });
    throw TransactionException.serviceUnavailable();
  }

  /** Best-effort: the merchant is being told this failed either way. */
  /**
   * Write the provider-confirmed destination onto the reserved row.
   *
   * The reserve writes the merchant's unverified values, because it has to run
   * before any upstream call. The inquiry is what turns them into the *bank's*
   * spelling, and that is the version worth keeping: it is what the merchant's
   * settlement webhook reports, and what a support question six months later is
   * answered from.
   *
   * **Called right after the inquiry, not folded into the post-payment update.**
   * Every failure path in the payment leg marks the row FAILED and throws, which
   * skips the post-payment update entirely - so folding it there would leave a
   * verified beneficiary unrecorded on exactly the payouts someone later has to
   * explain.
   *
   * **Fatal, unlike `markFailed` and the post-payment update.** Both of those
   * swallow, because by then money is in flight and raising would invite a retry
   * that pays the recipient twice. Here nothing has moved yet, so refusing to
   * continue with a row we could not update is the safe direction.
   */
  async recordBeneficiary(
    disbursementId: number,
    beneficiary: {
      accountHolderName: string;
      accountNumber: string;
      bankCode: string;
    },
  ): Promise<void> {
    try {
      await this.prismaMaster.disbursementTransaction.update({
        where: { id: disbursementId },
        data: {
          accountHolderName: beneficiary.accountHolderName,
          accountNumber: beneficiary.accountNumber,
          bankCode: beneficiary.bankCode,
        },
      });
    } catch (error) {
      this.logger.error({
        msg: 'Beneficiary verified but could not be recorded - not sending the payout',
        disbursementId,
        error,
      });
      throw TransactionException.internalError();
    }
  }

  async markFailed(
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
   * because the merchant's next move differs: a bad bank or wallet code is their
   * payload to fix, and a short deposit is ours - and telling them to retry into
   * an empty float would just burn their time.
   */
  toMerchantFailure(
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
   *
   * The distinction decides between a retryable 503/504 and a 4xx the merchant
   * must not repeat unchanged.
   */
  isTransportFailure(error: unknown): boolean {
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
