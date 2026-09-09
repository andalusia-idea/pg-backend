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
import { UpstreamException } from '@app/upstream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@transaction/prisma';

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * What a pay-in means, independent of which instrument collects it.
 *
 * **Not a facade** - there is no `createPurchase` here. Each instrument owns
 * its own entry point (`PurchaseQrisService`, and a virtual-account sibling
 * when that lands); this holds the decisions they must agree on.
 *
 * The instruments differ in what the customer is given and what the provider
 * calls it. They do **not** differ in how a merchant is routed, how a
 * reservation conflict is reported, or what an unreachable provider means -
 * and those are precisely the things that must not drift apart between two
 * ways of taking the same money.
 *
 * Mirrors `DisbursementCommonService` on the payout side deliberately: the
 * pay-in and payout flows are not the same, but the shape of "shared core plus
 * one service per rail" is, and a reader who has understood one should
 * recognise the other.
 */
@Injectable()
export class PurchaseCommonService {
  private readonly logger = new Logger(PurchaseCommonService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,

    private readonly profileClient: ProfileClient,
  ) {}

  readonly userRole = UserRoleEnum.MERCHANT;
  readonly transactionType = TransactionTypeEnum.PURCHASE;

  /**
   * Which provider this merchant routes a pay-in to.
   *
   * A merchant with no fee configuration for that payment method gets a 403,
   * not a 500: they are authenticated and their request is well-formed, we
   * simply have not enabled the product for them. That is an onboarding gap
   * someone on our side has to close, and saying so is more useful than a
   * generic error that sends them to re-read their signing code.
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
   * Always throws. A duplicate `merchantReference` is usually a retry of a
   * request that already succeeded, so it earns a 409 that tells the merchant
   * to go and look it up. A `systemReference` collision is our generator's
   * fault, and a 409 blaming the merchant would send them hunting a bug in
   * their own code.
   */
  reserveFailure({
    error,
    userId,
    systemReference,
    merchantReference,
    instrument,
  }: {
    error: unknown;
    userId: number;
    systemReference: string;
    merchantReference: string;
    instrument: string;
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
        msg: `Duplicate merchantReference on ${instrument} purchase`,
        userId,
        merchantReference,
      });
      throw TransactionException.duplicateMerchantReference(merchantReference);
    }

    this.logger.error({
      msg: `Failed to reserve ${instrument} purchase transaction`,
      userId,
      systemReference,
      error,
    });
    throw TransactionException.serviceUnavailable();
  }

  /** Best-effort: the merchant is being told this failed either way. */
  async markFailed(
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
