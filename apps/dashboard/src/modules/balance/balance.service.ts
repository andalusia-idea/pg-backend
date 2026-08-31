import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient, TransactionTypeEnum } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  BalanceAgentDto,
  BalanceDto,
  BalanceMerchantDto,
} from './dto/balance.dto';

const ZERO = '0';

/**
 * Transaction types the aggregate endpoints count.
 *
 * PURCHASE is excluded, so an aggregate reflects each holder's balance as of
 * their last non-purchase movement. Note the single-holder endpoints below do
 * NOT apply this filter, so the sum of individual balances will not always
 * match the aggregate - see the finding in docs/dashboard-migration.md.
 * Ported as-is because changing it changes numbers on the dashboard.
 */
const AGGREGATE_TRANSACTION_TYPES = [
  TransactionTypeEnum.WITHDRAW,
  TransactionTypeEnum.TOPUP,
  TransactionTypeEnum.DISBURSEMENT,
  TransactionTypeEnum.SETTLEMENT_PURCHASE,
];

/**
 * Balance logs are append-only snapshots: each row carries the resulting
 * balance, so "current balance" is the newest row. Ordering by createdAt alone
 * has no tiebreak when two rows share a timestamp, so id is the secondary sort -
 * it is monotonic on an append-only table, making the pick deterministic.
 */
const LATEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

@Injectable()
export class BalanceService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async checkBalanceMerchant(merchantId: number): Promise<BalanceMerchantDto> {
    const latest = await this.prismaSlave.merchantBalanceLog.findFirst({
      where: { merchantId, deletedAt: null },
      orderBy: [...LATEST_FIRST],
      select: { balanceActive: true, balancePending: true },
    });

    // No log rows yet means no movement yet, which is a zero balance rather
    // than a missing merchant - so this returns zeroes instead of a 404.
    return new BalanceMerchantDto({
      merchantId,
      balanceActive: (latest?.balanceActive as unknown as string) ?? ZERO,
      balancePending: (latest?.balancePending as unknown as string) ?? ZERO,
    });
  }

  async checkBalanceAgent(agentId: number): Promise<BalanceAgentDto> {
    const latest = await this.prismaSlave.agentBalanceLog.findFirst({
      where: { agentId, deletedAt: null },
      orderBy: [...LATEST_FIRST],
      select: { balanceActive: true, balancePending: true },
    });

    return new BalanceAgentDto({
      agentId,
      balanceActive: (latest?.balanceActive as unknown as string) ?? ZERO,
      balancePending: (latest?.balancePending as unknown as string) ?? ZERO,
    });
  }

  async aggregateBalanceMerchant(): Promise<BalanceDto> {
    const latestPerMerchant =
      await this.prismaSlave.merchantBalanceLog.findMany({
        distinct: ['merchantId'],
        where: {
          deletedAt: null,
          transactionType: { in: AGGREGATE_TRANSACTION_TYPES },
        },
        orderBy: [...LATEST_FIRST],
        select: { balanceActive: true, balancePending: true },
      });

    return sumBalances(latestPerMerchant);
  }

  async aggregateBalanceAgent(): Promise<BalanceDto> {
    const latestPerAgent = await this.prismaSlave.agentBalanceLog.findMany({
      distinct: ['agentId'],
      where: {
        deletedAt: null,
        transactionType: { in: AGGREGATE_TRANSACTION_TYPES },
      },
      orderBy: [...LATEST_FIRST],
      select: { balanceActive: true, balancePending: true },
    });

    return sumBalances(latestPerAgent);
  }

  /**
   * Internal (house) balance. Unlike merchant/agent, this is a single running
   * balance rather than one per holder, so the newest row is the answer - no
   * per-holder dedupe needed.
   *
   * No provider filter: the column it read was dropped in the transaction v2
   * schema, which made the three balance logs uniform. The filter was
   * misleading regardless - every row carries the running *house* total, so
   * narrowing to one provider and taking the newest match returned the whole
   * internal balance as of that provider's last movement, never that
   * provider's share of it. See D18.
   */
  async aggregateBalanceInternal(): Promise<BalanceDto> {
    const latest = await this.prismaSlave.internalBalanceLog.findFirst({
      where: {
        deletedAt: null,
        transactionType: { in: AGGREGATE_TRANSACTION_TYPES },
      },
      orderBy: [...LATEST_FIRST],
      select: { balanceActive: true, balancePending: true },
    });

    return new BalanceDto({
      balanceActive: (latest?.balanceActive as unknown as string) ?? ZERO,
      balancePending: (latest?.balancePending as unknown as string) ?? ZERO,
    });
  }
}

/** Decimal, not float: summing money in binary floating point drifts. */
function sumBalances(
  rows: { balanceActive: unknown; balancePending: unknown }[],
): BalanceDto {
  let active = new Decimal(0);
  let pending = new Decimal(0);

  for (const row of rows) {
    active = active.plus(new Decimal(String(row.balanceActive)));
    pending = pending.plus(new Decimal(String(row.balancePending)));
  }

  return new BalanceDto({
    balanceActive: active.toFixed(2),
    balancePending: pending.toFixed(2),
  });
}
