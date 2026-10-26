import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import {
  BalanceBucketEnum,
  BalanceHolderTypeEnum,
  PrismaClient,
} from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  BalanceAgentDto,
  BalanceDto,
  BalanceMerchantDto,
} from './dto/balance.dto';

const ZERO = '0';

@Injectable()
export class BalanceService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  private separateByBucket(
    snapshots: {
      bucket: BalanceBucketEnum;
      amount: Decimal;
    }[],
  ) {
    let available = ZERO;
    let pending = ZERO;
    let reserved = ZERO;
    for (const s of snapshots) {
      if (BalanceBucketEnum.AVAILABLE === s.bucket)
        available = s.amount?.toFixed();
      else if (BalanceBucketEnum.PENDING === s.bucket)
        pending = s.amount?.toFixed();
      else if (BalanceBucketEnum.RESERVED === s.bucket)
        reserved = s.amount?.toFixed();
    }
    return { available, pending, reserved };
  }

  async checkBalanceMerchant(merchantId: number): Promise<BalanceMerchantDto> {
    const snapshots = await this.prismaSlave.balanceSnapshot.findMany({
      where: {
        holderType: BalanceHolderTypeEnum.MERCHANT,
        holderId: merchantId,
      },
      select: {
        amount: true,
        bucket: true,
      },
    });

    const balance = this.separateByBucket(snapshots);

    // No log rows yet means no movement yet, which is a zero balance rather
    // than a missing merchant - so this returns zeroes instead of a 404.
    return new BalanceMerchantDto({
      merchantId,
      balanceActive: balance.available,
      balancePending: balance.pending,
      balanceReserved: balance.reserved,
    });
  }

  async checkBalanceAgent(agentId: number): Promise<BalanceAgentDto> {
    const snapshots = await this.prismaSlave.balanceSnapshot.findMany({
      where: {
        holderType: BalanceHolderTypeEnum.MERCHANT,
        holderId: agentId,
      },
      select: {
        amount: true,
        bucket: true,
      },
    });

    const balance = this.separateByBucket(snapshots);

    return new BalanceAgentDto({
      agentId,
      balanceActive: balance.available,
      balancePending: balance.pending,
      balanceReserved: balance.reserved,
    });
  }

  async aggregateBalanceMerchant(): Promise<BalanceDto> {
    const snapshots = await this.prismaSlave.balanceSnapshot.groupBy({
      where: { holderType: BalanceHolderTypeEnum.MERCHANT },
      by: ['bucket'],
      _sum: {
        amount: true,
      },
    });

    const balance = this.separateByBucket(
      snapshots.map((s) => ({
        bucket: s.bucket,
        amount: s._sum.amount ?? new Decimal(0),
      })),
    );

    return new BalanceDto({
      balanceActive: balance.available,
      balancePending: balance.pending,
      balanceReserved: balance.reserved,
    });
  }

  async aggregateBalanceAgent(): Promise<BalanceDto> {
    const snapshots = await this.prismaSlave.balanceSnapshot.groupBy({
      where: { holderType: BalanceHolderTypeEnum.AGENT },
      by: ['bucket'],
      _sum: {
        amount: true,
      },
    });

    const balance = this.separateByBucket(
      snapshots.map((s) => ({
        bucket: s.bucket,
        amount: s._sum.amount ?? new Decimal(0),
      })),
    );

    return new BalanceDto({
      balanceActive: balance.available,
      balancePending: balance.pending,
      balanceReserved: balance.reserved,
    });
  }

  async aggregateBalanceInternal(): Promise<BalanceDto> {
    const snapshots = await this.prismaSlave.balanceSnapshot.groupBy({
      where: { holderType: BalanceHolderTypeEnum.INTERNAL },
      by: ['bucket'],
      _sum: {
        amount: true,
      },
    });

    const balance = this.separateByBucket(
      snapshots.map((s) => ({
        bucket: s.bucket,
        amount: s._sum.amount ?? new Decimal(0),
      })),
    );

    return new BalanceDto({
      balanceActive: balance.available,
      balancePending: balance.pending,
      balanceReserved: balance.reserved,
    });
  }
}
