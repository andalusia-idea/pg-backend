import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ApiError } from '../../shared/exception';
import { BaseFeeDto } from '../config-fee/dto/base-fee.dto';
import {
  ActionEnum,
  AGENT_SHAREHOLDER_TOTAL_PERCENTAGE,
} from './config-merchant.constant';
import {
  AgentShareholderDto,
  MerchantBaseFeeConfigDto,
  MerchantConfigDto,
  MerchantFeeDto,
  MerchantIntervalDto,
} from './dto/merchant-config.dto';
import {
  UpsertMerchantAgentShareholderDto,
  UpsertMerchantFeeDto,
} from './dto/upsert-merchant-fee.dto';
import { FeeRedis } from '@app/redis';

const ZERO = '0';

@Injectable()
export class ConfigMerchantService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,

    private readonly feeRedis: FeeRedis,
  ) {}

  async findMerchantIntervalById(
    merchantId: number,
  ): Promise<MerchantIntervalDto> {
    const merchant = await this.prismaSlave.merchant.findFirst({
      where: { id: merchantId, deletedAt: null },
      select: { id: true, settlementInterval: true, lastSettlementAt: true },
    });
    if (!merchant) throw ApiError.notFound('Merchant config');

    return new MerchantIntervalDto({
      userId: merchant.id,
      settlementInterval: merchant.settlementInterval,
      lastSettlementAt: merchant.lastSettlementAt as unknown as string | null,
    });
  }

  /**
   * Every active base fee, each paired with this merchant's override if one
   * exists, plus the merchant's agent shareholders and settlement interval.
   */
  async findAllConfigByMerchantId(
    merchantId: number,
  ): Promise<MerchantConfigDto> {
    const merchant = await this.prismaSlave.merchant.findFirst({
      where: { id: merchantId, deletedAt: null },
      select: { settlementInterval: true, lastSettlementAt: true },
    });
    if (!merchant) throw ApiError.notFound('Merchant config');

    const [agentShareholders, baseFees] = await Promise.all([
      this.prismaSlave.agentShareholder.findMany({
        where: { merchantId, deletedAt: null },
        orderBy: { agentId: 'asc' },
      }),
      // One query with a filtered relation rather than N+1: each
      // merchantId+baseFeeId pair is unique, so at most one override per row.
      this.prismaSlave.baseFee.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: [
          { providerName: 'asc' },
          { paymentMethodName: 'asc' },
          { transactionType: 'asc' },
        ],
        include: {
          merchantFees: {
            where: { merchantId, deletedAt: null },
            take: 1,
          },
        },
      }),
    ]);

    const fees = baseFees
      .map(
        (baseFee) =>
          new MerchantBaseFeeConfigDto({
            baseFeeConfig: new BaseFeeDto(baseFee as never),
            merchantFeeConfig: baseFee.merchantFees[0]
              ? new MerchantFeeDto(baseFee.merchantFees[0] as never)
              : null,
          }),
      )
      // Configured fees first, then unconfigured; each group by code.
      .sort((a, b) => {
        const aConfigured = a.merchantFeeConfig !== null;
        const bConfigured = b.merchantFeeConfig !== null;
        if (aConfigured !== bConfigured) return aConfigured ? -1 : 1;
        return a.baseFeeConfig.code.localeCompare(b.baseFeeConfig.code);
      });

    return new MerchantConfigDto({
      settlementInterval: merchant.settlementInterval,
      lastSettlementAt: merchant.lastSettlementAt as unknown as string | null,
      agentShareholders:
        agentShareholders.length === 0
          ? null
          : agentShareholders.map(
              (shareholder) => new AgentShareholderDto(shareholder as never),
            ),
      fees,
    });
  }

  /** Applies a batch of fee inserts/updates/deletes atomically. */
  async upsertProvider(
    merchantId: number,
    body: UpsertMerchantFeeDto[],
  ): Promise<void> {
    await this.prismaMaster.$transaction(async (tx) => {
      for (const fee of body) {
        const {
          action,
          baseFeeId,
          feeInternalFixed,
          feeInternalPercentage,
          feeAgentFixed,
          feeAgentPercentage,
        } = fee;

        const key = { merchantId_baseFeeId: { merchantId, baseFeeId } };

        if (action === ActionEnum.D) {
          await tx.merchantFee.delete({ where: key });
          continue;
        }

        const values = {
          feeInternalFixed,
          feeInternalPercentage,
          feeAgentFixed: feeAgentFixed ?? ZERO,
          feeAgentPercentage: feeAgentPercentage ?? ZERO,
        };

        await tx.merchantFee.upsert({
          where: key,
          create: { merchantId, baseFeeId, ...values },
          update: values,
        });

        await this.feeRedis.deleteMerchantFee(merchantId, baseFeeId);
      }
    });
  }

  /** Applies a batch of shareholder changes atomically. */
  async upsertAgentShareholder(
    merchantId: number,
    body: UpsertMerchantAgentShareholderDto[],
  ): Promise<void> {
    this.assertShareholderPercentagesTotal(body);

    await this.prismaMaster.$transaction(async (tx) => {
      for (const shareholder of body) {
        const { action, agentId, percentagePerAgent } = shareholder;
        const key = { agentId_merchantId: { agentId, merchantId } };

        if (action === ActionEnum.D) {
          await tx.agentShareholder.delete({ where: key });
          continue;
        }

        await tx.agentShareholder.upsert({
          where: key,
          create: { merchantId, agentId, percentagePerAgent },
          update: { percentagePerAgent },
        });

        await this.feeRedis.deleteAgentShareholder(merchantId);
      }
    });
  }

  /**
   * The surviving shareholders must account for exactly 100% of the merchant.
   *
   * Checks the submitted batch, not the resulting table - so the frontend has to
   * post the merchant's complete shareholder set, which is what it does.
   * Summed with Decimal rather than floats: 33.3333 x 3 does not reach 100 in
   * binary floating point.
   */
  private assertShareholderPercentagesTotal(
    body: UpsertMerchantAgentShareholderDto[],
  ): void {
    const total = body
      .filter((shareholder) => shareholder.action !== ActionEnum.D)
      .reduce(
        (sum, shareholder) =>
          sum.plus(new Decimal(shareholder.percentagePerAgent)),
        new Decimal(0),
      );

    if (!total.eq(AGENT_SHAREHOLDER_TOTAL_PERCENTAGE)) {
      throw ApiError.badRequest(
        `Sum of agent shareholder percentage must be ${AGENT_SHAREHOLDER_TOTAL_PERCENTAGE}%`,
        { percentagePerAgent: `Current sum is ${total.toFixed(4)}%` },
      );
    }
  }
}
