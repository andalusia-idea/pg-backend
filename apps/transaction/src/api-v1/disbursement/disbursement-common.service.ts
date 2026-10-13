import {
  FeeCalculateConfigClient,
  FeeCalculationResultDto,
  FeeTypeEnum,
  FilterDisbursementFeeDto,
  PaymentMethodNameEnum,
  ProfileClient,
  ProviderNameEnum,
  getAuditUserId,
  SYSTEM_USER_ID,
  TransactionException,
  TransactionStatusEnum,
  TransactionTypeEnum,
  UserRoleEnum,
} from '@app/microservice';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import {
  METADATA_KEY,
  UpstreamException,
  UpstreamTransferResponseDto,
} from '@app/upstream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@transaction/prisma';
import {
  MotionPayBillerService,
  MotionPayTransferService,
} from '../../upstream/motionpay';
import { DEFAULT_SYSTEM_REFERENCE_LENGTH } from '../transaction.helper';
import { CreateTransferRequestDto } from './disbursement.dto';
import Decimal from 'decimal.js';
import {
  BalanceBucketEnum,
  BalanceDirectionEnum,
  BalanceHolderTypeEnum,
  BalanceLeg,
  BalanceMovement,
  BalanceReasonEnum,
  BalanceService,
  BalanceTx,
  BalanceSourceTypeEnum,
  INTERNAL_HOLDER_ID,
} from '@app/balance';

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/** Just enough of a `DisbursementFeeDetail` row to build the payout legs from. */
type PayoutFeeDetail = {
  type: FeeTypeEnum;
  nominal: Decimal;
  agentId: number | null;
};

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
    private readonly feeCalculateClient: FeeCalculateConfigClient,
    private readonly balanceService: BalanceService,

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
      return this.motionPayBillerService.systemReferenceMaxLength;
    }

    return DEFAULT_SYSTEM_REFERENCE_LENGTH;
  }

  async calculateFee({
    merchantId,
    providerName,
    paymentMethodName,
    nominal,
  }: FilterDisbursementFeeDto): Promise<FeeCalculationResultDto | null> {
    try {
      return await this.feeCalculateClient.disbursement({
        merchantId,
        providerName,
        paymentMethodName,
        nominal,
      });
    } catch (error) {
      this.logger.error({
        msg: 'Fee calculation failed',
        merchantId,
        error,
      });
      return null;
    }
  }

  async reserveTransactionAndBalance({
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
    const fee = await this.calculateFee({
      merchantId: userId,
      providerName,
      paymentMethodName,
      nominal: dto.amount.value,
    });

    // Refused, not tolerated. The pay-in path records a capture with no fee
    // breakdown because the money already moved and recording nothing would be
    // worse. A payout is the opposite: nothing has moved yet, and the amount to
    // reserve *is* the fee calculation - `netNominal` is `nominal` plus fees for
    // a disbursement. Reserving `nominal` instead would let every payout
    // overdraw the merchant by exactly the fee.
    //
    // `serviceUnavailable`, not `internalError`: a fee-service outage is a
    // dependency being down, and "retry later" is correct advice. An internal
    // error tells the merchant their request was malformed, which it was not.
    if (!fee) {
      this.logger.error({
        msg: `Cannot reserve ${paymentMethodName} payout: fee calculation unavailable`,
        userId,
        systemReference,
        merchantReference: dto.merchantReference,
      });
      throw TransactionException.serviceUnavailable();
    }
    try {
      return await this.prismaMaster.$transaction(async (tx) => {
        const row = await tx.disbursementTransaction.create({
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
            netNominal: new Decimal(fee.merchantFee.netNominal),

            status: TransactionStatusEnum.PENDING,

            feeDetails: { create: this.buildFeeDetails(fee) },
          },
          select: { id: true },
        });

        // Only the merchant moves here, and only between their own buckets.
        // Internal and agent fees are credited on PAYOUT_COMPLETED, not now -
        // the fee is not earned until the payout actually works, and crediting
        // early would mean PAYOUT_FAILED had to reverse those credits too.
        //
        // `userId`, not `fee.merchantFee.merchantId`: the fee service echoes the
        // id back and they should agree, but trusting a remote echo over the
        // value in hand means a disagreement reserves against the wrong
        // merchant with nothing to catch it.
        const reserved = await this.balanceService.reserve(tx, {
          holderType: BalanceHolderTypeEnum.MERCHANT,
          holderId: userId,
          amount: new Decimal(fee.merchantFee.netNominal),
          sourceType: BalanceSourceTypeEnum.DISBURSEMENT,
          sourceId: row.id,
          createdBy: SYSTEM_USER_ID,
        });

        // Rolls the row back with it, so a merchant who cannot afford the payout
        // ends up with no transaction at all rather than a PENDING one nobody
        // will ever settle. `reserve` returns rather than throws precisely so
        // the caller picks the merchant-facing error.
        if (!reserved.ok) throw TransactionException.insufficientBalance();

        return row.id;
      });
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

  /**
   * Release the merchant's reservation the way the outcome demands.
   *
   * The single entry point for a settled payout's balance effect - the webhook
   * says what happened and this owns what that means, so leg shapes stay in one
   * file. Runs on the caller's transaction, so it commits with the status
   * update or not at all.
   */
  async postPayoutOutcome(
    tx: BalanceTx,
    {
      disbursementId,
      merchantId,
      netNominal,
      isPaid,
    }: {
      disbursementId: number;
      merchantId: number;
      netNominal: Decimal;
      isPaid: boolean;
    },
  ): Promise<void> {
    if (!isPaid) {
      await this.balanceService.post(
        tx,
        this.buildPayoutFailed(disbursementId, merchantId, netNominal),
      );
      return;
    }

    // Only read on the paid path: a failed payout earns nobody anything, so the
    // fee rows have nothing to say about it.
    const feeDetails = await tx.disbursementFeeDetail.findMany({
      where: { disbursementId },
      select: { type: true, nominal: true, agentId: true },
    });

    await this.balanceService.post(
      tx,
      this.buildPayoutCompleted(
        disbursementId,
        merchantId,
        netNominal,
        feeDetails,
      ),
    );
  }

  /**
   * The payout worked: consume the merchant's reservation, and pay out the fees
   * that were earned by it.
   *
   * ```
   * MERCHANT | RESERVED  | DEBIT  | netNominal
   * INTERNAL | AVAILABLE | CREDIT | internalFee
   * AGENT    | AVAILABLE | CREDIT | agentFee      (one per agent)
   * ```
   *
   * **`netNominal` comes from the row, not from the fee details.** It has to be
   * the exact figure `reserve()` credited to RESERVED, or the debit leaves a
   * residue stuck in that bucket forever - and the nightly check would not
   * notice, because entries and snapshot would still agree. The merchant fee
   * detail carries `nominal`, a *different* number on the same DTO, so reading
   * it from there is the one mistake this signature exists to prevent.
   *
   * **The fees land in AVAILABLE, not PENDING.** PENDING models "waiting for an
   * upstream to settle", and this money came out of the merchant's already
   * settled balance - there is nothing to wait for. It would also strand there:
   * the settlement batch claims purchases, never disbursements.
   *
   * **The provider fee gets no leg**, same as a pay-in: the upstream keeps it
   * and it never reaches a balance we track. Net across the holders is
   * therefore `-(nominal + providerFee)` - exactly the money that left.
   */
  private buildPayoutCompleted(
    disbursementId: number,
    merchantId: number,
    netNominal: Decimal,
    feeDetails: PayoutFeeDetail[],
  ): BalanceMovement {
    const legs: BalanceLeg[] = [
      {
        holderType: BalanceHolderTypeEnum.MERCHANT,
        holderId: merchantId,
        amount: netNominal,
        bucket: BalanceBucketEnum.RESERVED,
        direction: BalanceDirectionEnum.DEBIT,
      },
    ];

    for (const feeDetail of feeDetails) {
      if (FeeTypeEnum.INTERNAL === feeDetail.type) {
        legs.push({
          holderType: BalanceHolderTypeEnum.INTERNAL,
          holderId: INTERNAL_HOLDER_ID,
          amount: new Decimal(feeDetail.nominal),
          bucket: BalanceBucketEnum.AVAILABLE,
          direction: BalanceDirectionEnum.CREDIT,
        });
      }

      if (FeeTypeEnum.AGENT === feeDetail.type) {
        // An agent fee with no agent cannot be credited to anyone. Without this
        // the id reaches Prisma as null and surfaces as a foreign-key error
        // several frames away from the row that caused it.
        if (feeDetail.agentId === null) {
          this.logger.error({
            msg: 'Agent fee detail has no agentId; cannot credit it',
            disbursementId,
            nominal: feeDetail.nominal.toFixed(2),
          });
          throw TransactionException.internalError();
        }

        legs.push({
          holderType: BalanceHolderTypeEnum.AGENT,
          holderId: feeDetail.agentId,
          amount: new Decimal(feeDetail.nominal),
          bucket: BalanceBucketEnum.AVAILABLE,
          direction: BalanceDirectionEnum.CREDIT,
        });
      }
    }

    return {
      reason: BalanceReasonEnum.PAYOUT_COMPLETED,
      sourceType: BalanceSourceTypeEnum.DISBURSEMENT,
      sourceId: disbursementId,
      createdBy: SYSTEM_USER_ID,
      legs,
    };
  }

  /**
   * The payout did not happen: give the reservation back, whole.
   *
   * ```
   * MERCHANT | RESERVED  | DEBIT  | netNominal
   * MERCHANT | AVAILABLE | CREDIT | netNominal
   * ```
   *
   * No fee legs. The fee is earned by a payout that works, so there is nothing
   * to credit and - because nothing was credited at reservation time - nothing
   * to reverse either. `PAYOUT_FAILED` is a transfer reason, so `post()`
   * asserts these two net to zero for the merchant.
   */
  private buildPayoutFailed(
    disbursementId: number,
    merchantId: number,
    netNominal: Decimal,
  ): BalanceMovement {
    const legs: BalanceLeg[] = [
      {
        holderType: BalanceHolderTypeEnum.MERCHANT,
        holderId: merchantId,
        amount: netNominal,
        bucket: BalanceBucketEnum.RESERVED,
        direction: BalanceDirectionEnum.DEBIT,
      },
      {
        holderType: BalanceHolderTypeEnum.MERCHANT,
        holderId: merchantId,
        amount: netNominal,
        bucket: BalanceBucketEnum.AVAILABLE,
        direction: BalanceDirectionEnum.CREDIT,
      },
    ];
    return {
      reason: BalanceReasonEnum.PAYOUT_FAILED,
      sourceType: BalanceSourceTypeEnum.DISBURSEMENT,
      sourceId: disbursementId,
      createdBy: SYSTEM_USER_ID,
      legs,
    };
  }

  /** One row per party. Agents are itemised rather than collapsed to a total. */
  /**
   * `createdBy` is set here, on every row, rather than left to the audit
   * extension.
   *
   * These go in as a **nested** create under the parent's `create`, and the
   * extension only merges audit fields into the top level - it sees one
   * operation on `DisbursementTransaction` and never walks into the relation
   * payload. So the parent row gets stamped and these do not, which is easy to
   * miss because `DisbursementFeeDetail` *is* in `AUDITED_MODELS` and therefore
   * looks covered.
   *
   * The principal comes from CLS, so this does not care which path it is on:
   * `MerchantSignatureGuard` puts the merchant's id there on the API, and the
   * callback interceptor puts the provider's. `SYSTEM_USER_ID` only if neither
   * did, which would mean no context at all rather than a fee attributable to
   * someone else.
   */
  private buildFeeDetails(
    fee: FeeCalculationResultDto,
  ): Prisma.DisbursementFeeDetailCreateWithoutDisbursementTransactionInput[] {
    const createdBy = getAuditUserId() ?? SYSTEM_USER_ID;

    return [
      {
        createdBy,
        type: FeeTypeEnum.MERCHANT,
        nominal: new Decimal(fee.merchantFee.netNominal),
        feePercentage: new Decimal(fee.merchantFee.feePercentage),
      },
      {
        createdBy,
        type: FeeTypeEnum.PROVIDER,
        nominal: new Decimal(fee.providerFee.nominal),
        feeFixed: new Decimal(fee.providerFee.feeFixed),
        feePercentage: new Decimal(fee.providerFee.feePercentage),
      },
      {
        createdBy,
        type: FeeTypeEnum.INTERNAL,
        nominal: new Decimal(fee.internalFee.nominal),
        feeFixed: new Decimal(fee.internalFee.feeFixed),
        feePercentage: new Decimal(fee.internalFee.feePercentage),
      },
      ...fee.agentFee.agents.map((agent) => ({
        createdBy,
        type: FeeTypeEnum.AGENT,
        agentId: agent.agentId,
        nominal: new Decimal(agent.nominal),
        feePercentage: new Decimal(agent.feePercentage),
      })),
    ];
  }

  async recordUpstreamResult(
    disbursementId: number,
    upstream: UpstreamTransferResponseDto,
  ): Promise<void> {
    try {
      await this.prismaMaster.disbursementTransaction.update({
        where: { id: disbursementId },
        data: {
          providerReference: upstream.providerReference,
          bankReference: upstream.bankReference,

          accountHolderName: upstream.accountHolderName,
          accountNumber: upstream.accountNumber,
          bankCode: upstream.bankCode,

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
    // Already a merchant-facing error - an insufficient balance, say - so let
    // it through untouched. Without this, a deliberate rejection raised inside
    // the reservation transaction falls through to `serviceUnavailable` below
    // and the merchant is told to retry something that can never succeed.
    if (error instanceof TransactionException) throw error;

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

  /**
   * Mark a payout FAILED, filing the error under the key for the leg it came
   * from, and describing the error rather than guessing at it.
   *
   * **Written once because the obvious version is wrong.** The hand-rolled
   * shape this replaces was
   * `markFailed(id, { [key]: { reason: 'no client for provider' } })` for any
   * `TransactionException` - but `invalidBeneficiary` is a `TransactionException`
   * too, so a merchant mistyping an account number produced metadata reading
   * *"no client for provider"*. Whoever read that went looking for a routing
   * bug that did not exist.
   *
   * `TransactionException` carries `failure`, which names the actual condition,
   * so there is no need to guess. An `UpstreamException` already carries the
   * provider's own payload in `context`; anything else only has a message worth
   * keeping.
   */
  async markFailedFrom(
    disbursementId: number,
    metadataKey: METADATA_KEY,
    error: unknown,
  ): Promise<void> {
    let detail: Record<string, unknown>;

    if (error instanceof TransactionException) {
      detail = { failure: error.failure, message: error.message };
    } else if (error instanceof UpstreamException) {
      detail = {
        provider: error.provider,
        message: error.message,
        ...error.context,
      };
    } else {
      detail = {
        message: error instanceof Error ? error.message : 'unknown failure',
      };
    }

    await this.markFailed(disbursementId, { [metadataKey]: detail });
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
