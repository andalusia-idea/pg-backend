import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionException,
  TransactionStatusEnum,
} from '@app/microservice';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import {
  UpstreamEWalletInquiryResponseDto,
  UpstreamEWalletTopupRequestDto,
  UpstreamEWalletTopupResponseDto,
  UpstreamException,
} from '@app/upstream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@transaction/prisma';
import Decimal from 'decimal.js';
import {
  MOTIONPAY_METADATA_KEY,
  MotionPayBillerService,
} from '../../upstream/motionpay';
import { generateSystemReference } from '../transaction.helper';
import { DisbursementCommonService } from './disbursement-common.service';
import {
  CreateTransferEWalletDataDto,
  CreateTransferEWalletRequestDto,
} from './disbursement.dto';

/**
 * E-wallet payouts, over the provider's bill-payment rails.
 *
 * Sibling of `DisbursementBankService`, reaching the same kind of destination
 * by a cheaper road. What it shares with that service lives in
 * `DisbursementCommonService`; what differs is here, and it is more than the
 * addressing:
 *
 * - **Three upstream calls, not two.** A biller inquiry is not a free
 *   validation like a bank account lookup - it opens a transaction at the
 *   provider and discovers the price, and returns a reference the payment leg
 *   cannot proceed without.
 * - **The row is reserved before the first upstream call**, not after the
 *   inquiry, because from the inquiry onward there is provider-side state we
 *   have to be able to account for.
 */
@Injectable()
export class DisbursementEWalletService {
  private readonly logger = new Logger(DisbursementEWalletService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,

    private readonly common: DisbursementCommonService,
    private readonly motionPayBillerService: MotionPayBillerService,
  ) {}

  private readonly paymentMethodName = PaymentMethodNameEnum.TRANSFEREWALLET;

  /**
   * Top up an e-wallet on a merchant's behalf.
   *
   * The same payout as the bank flow from the merchant's side, taking a
   * different road: the provider's bill-payment rails reach wallets for
   * materially less than their transfer rails, and that price difference is the
   * entire reason this path exists.
   *
   * Idempotency works exactly as it does for a bank payout - the insert claims
   * `@@unique([merchantId, merchantReference])`, so a retried request is
   * rejected atomically rather than topping the wallet up twice.
   */
  async createTransfer(
    userId: number,
    dto: CreateTransferEWalletRequestDto,
  ): Promise<CreateTransferEWalletDataDto> {
    const providerName = await this.common.resolveProvider(
      userId,
      this.paymentMethodName,
    );

    const systemReference = generateSystemReference({
      userId,
      transactionType: this.common.transactionType,
      paymentMethodName: this.paymentMethodName,
      providerName,
      length: 32,
    });

    const disbursementId = await this.reserveTransaction({
      userId,
      providerName,
      systemReference,
      dto,
    });

    const request: UpstreamEWalletTopupRequestDto = {
      systemReference,
      providerName,
      merchantReference: dto.merchantReference,
      amount: dto.amount,
      eWallet: dto.eWallet,
      accountNumber: dto.accountNumber,
    };

    const inquiry = await this.inquire(disbursementId, request);
    const upstream = await this.pay(disbursementId, request, inquiry);

    await this.recordUpstreamResult(disbursementId, inquiry, upstream);

    return {
      transactionId: systemReference,
      merchantReference: dto.merchantReference,
      status: upstream.status,
      beneficiary: {
        eWallet: dto.eWallet,
        accountNumber: dto.accountNumber,
        accountHolderName: inquiry.accountHolderName,
      },
    };
  }

  /**
   * Reserve the payout row before the provider is touched at all.
   *
   * `recipientAccount` holds the wallet's phone number - the same column a bank
   * account number goes in, because it is the same thing: where the money is
   * going. A second column for the same concept would mean every query and
   * every reconciliation join had to branch on payment method before it could
   * find the destination.
   *
   * `recipientBankCode` holds the wallet name. The provider's product code goes
   * into `additionalInfo` rather than a column of its own - every upstream
   * codes its catalogue differently, so it is provider-shaped detail rather
   * than something the schema should have an opinion about.
   */
  private async reserveTransaction({
    userId,
    providerName,
    systemReference,
    dto,
  }: {
    userId: number;
    providerName: ProviderNameEnum;
    systemReference: string;
    dto: CreateTransferEWalletRequestDto;
  }): Promise<number> {
    try {
      const row = await this.prismaMaster.disbursementTransaction.create({
        data: {
          merchantId: userId,
          systemReference,
          merchantReference: dto.merchantReference,

          // Left empty rather than guessed: a wallet top-up may resolve no name
          // at all, and inventing one would put an unverified value where the
          // bank flow puts a bank-confirmed one.
          recipientName: '',
          recipientAccount: dto.accountNumber,
          recipientBankCode: dto.eWallet,

          providerName,
          paymentMethodName: this.paymentMethodName,
          nominal: new Decimal(dto.amount.value),

          status: TransactionStatusEnum.PENDING,
        },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      this.common.reserveFailure({
        error,
        userId,
        systemReference,
        merchantReference: dto.merchantReference,
        rail: 'e-wallet',
      });
    }
  }

  /**
   * Price the top-up and open the provider-side transaction.
   *
   * A rejection here is the cheapest failure available - nothing debited, no
   * money moved - so it is worth reaching before the payment leg rather than
   * discovering the destination is unusable afterwards.
   */
  private async inquire(
    disbursementId: number,
    request: UpstreamEWalletTopupRequestDto,
  ): Promise<UpstreamEWalletInquiryResponseDto> {
    try {
      switch (request.providerName) {
        case ProviderNameEnum.MOTIONPAY:
          return await this.motionPayBillerService.inquiry(request);
        default:
          this.logger.error({
            msg: 'No e-wallet client for routed provider',
            providerName: request.providerName,
            systemReference: request.systemReference,
          });
          throw TransactionException.internalError();
      }
    } catch (error) {
      if (error instanceof TransactionException) {
        await this.common.markFailed(disbursementId, {
          [MOTIONPAY_METADATA_KEY.PAYMENT_BILLER_ERROR]: {
            reason: 'no client for provider',
          },
        });
        throw error;
      }

      const timedOut = this.common.isTransportFailure(error);
      this.logger.error({
        msg: 'E-wallet inquiry failed',
        disbursementId,
        systemReference: request.systemReference,
        timedOut,
        context: error instanceof UpstreamException ? error.context : undefined,
        error,
      });

      if (timedOut) throw TransactionException.upstreamTimeout();

      await this.common.markFailed(disbursementId, {
        [MOTIONPAY_METADATA_KEY.PAYMENT_BILLER_ERROR]:
          error instanceof UpstreamException
            ? { message: error.message, ...error.context }
            : { message: 'unknown upstream failure' },
      });

      throw this.common.toMerchantFailure(
        error,
        request.systemReference,
        'billerInquiry',
      );
    }
  }

  /**
   * Confirm the top-up, debiting our biller deposit.
   *
   * A **timeout is deliberately not marked FAILED**: past this point the
   * provider may have debited us and credited the wallet, and asserting failure
   * on an unknown would tell the merchant their payout did not happen while the
   * recipient is holding the money. It stays PENDING for the status poll.
   */
  private async pay(
    disbursementId: number,
    request: UpstreamEWalletTopupRequestDto,
    inquiry: UpstreamEWalletInquiryResponseDto,
  ): Promise<UpstreamEWalletTopupResponseDto> {
    try {
      switch (request.providerName) {
        case ProviderNameEnum.MOTIONPAY:
          return await this.motionPayBillerService.payment(request, inquiry);
        default:
          throw TransactionException.internalError();
      }
    } catch (error) {
      if (error instanceof TransactionException) throw error;

      const timedOut = this.common.isTransportFailure(error);
      this.logger.error({
        msg: 'E-wallet payment failed',
        disbursementId,
        systemReference: request.systemReference,
        timedOut,
        context: error instanceof UpstreamException ? error.context : undefined,
        error,
      });

      if (timedOut) throw TransactionException.upstreamTimeout();

      await this.common.markFailed(disbursementId, {
        [MOTIONPAY_METADATA_KEY.PAYMENT_BILLER_ERROR]:
          error instanceof UpstreamException
            ? { message: error.message, ...error.context }
            : { message: 'unknown upstream failure' },
      });

      throw this.common.toMerchantFailure(
        error,
        request.systemReference,
        'billerPayment',
      );
    }
  }

  /**
   * Attach both legs' results to the reserved row.
   *
   * The product code lands in `additionalInfo`, not a column of its own: it is
   * the provider's catalogue identifier and every upstream spells that
   * differently. Reconciliation needs the value; the schema does not need an
   * opinion about it.
   */
  private async recordUpstreamResult(
    disbursementId: number,
    inquiry: UpstreamEWalletInquiryResponseDto,
    upstream: UpstreamEWalletTopupResponseDto,
  ): Promise<void> {
    try {
      await this.prismaMaster.disbursementTransaction.update({
        where: { id: disbursementId },
        data: {
          providerReference: upstream.providerReference || null,
          status: upstream.status,
          // Only when the provider actually resolved one - never fabricated.
          ...(inquiry.accountHolderName
            ? { recipientName: inquiry.accountHolderName }
            : {}),
          additionalInfo: {
            productCode: inquiry.productCode,
            productName: inquiry.productName,
            // What our deposit was debited: the nominal plus the provider's
            // cut. This is the number the price comparison against the transfer
            // rail is actually made on.
            upstreamFee: inquiry.fee,
            upstreamTotal: inquiry.total,
          } as Prisma.InputJsonValue,
          metadata: {
            ...inquiry.metadata,
            ...upstream.metadata,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Not raised: the top-up is already in flight. Telling the merchant it
      // failed would invite a retry that credits the wallet twice.
      this.logger.error({
        msg: 'E-wallet top-up sent but the transaction could not be updated - needs reconciliation',
        disbursementId,
        providerReference: upstream.providerReference,
        error,
      });
    }
  }
}
