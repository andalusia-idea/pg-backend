import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { Prisma, PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { Page, Pageable, paging } from '../../shared/pagination';
import {
  FilterTransactionDto,
  mapFeeDetails,
  resolveDateRange,
} from '../transaction-shared';
import { StatusWithdrawalDto } from './dto/status-withdrawal.dto';
import { WithdrawTransactionDto } from './dto/withdraw-transaction.dto';

@Injectable()
export class WithdrawService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findAll(
    pageable: Pageable,
    filter: FilterTransactionDto,
  ): Promise<Page<WithdrawTransactionDto>> {
    const where: Prisma.WithdrawTransactionWhereInput = {
      deletedAt: null,
      createdAt: resolveDateRange(filter.from, filter.to),
    };

    // WithdrawTransaction has no merchantId; the holder is userId + userRole,
    // so the shared `merchantId` filter maps onto userId here.
    if (filter.merchantId) where.userId = filter.merchantId;
    if (filter.providerName) where.providerName = filter.providerName;
    if (filter.paymentMethodName) {
      where.paymentMethodName = filter.paymentMethodName;
    }
    if (filter.status) where.status = filter.status;

    const { skip, take } = paging(pageable);

    const [total, items] = await this.prismaSlave.$transaction([
      this.prismaSlave.withdrawTransaction.count({ where }),
      this.prismaSlave.withdrawTransaction.findMany({
        where,
        include: { feeDetails: { where: { deletedAt: null } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    ]);

    // The row holds Prisma Decimal and Date values where the DTO declares
    // string; the ToMoneyString / ToJakartaISO transforms convert them during
    // serialization, so the cast bridges the pre-serialization shape.
    const data = items.map((item) => {
      const { feeDetails, totalFeeCut } = mapFeeDetails(item.feeDetails);

      return new WithdrawTransactionDto({
        ...item,
        metadata: item.metadata as Record<string, unknown> | null,
        totalFeeCut,
        feeDetails,
      } as unknown as WithdrawTransactionDto);
    });

    return new Page<WithdrawTransactionDto>({ pageable, total, data });
  }

  /**
   * STUB - approve is not implemented. Wired up so the frontend can integrate
   * against the real request/response shape now; the actual balance-ledger
   * write (advisory locks, transaction-scoping) is pending the D17 decision -
   * see docs/dashboard-migration.md §2.3, row 40 and §5 (D17). Intentionally a
   * no-op until that lands: no DB write happens here yet.
   */
  approve(dto: StatusWithdrawalDto): Promise<void> {
    // TODO(backend): D17 balance-ledger write, per docs/dashboard-migration.md.
    void dto;
    return Promise.resolve();
  }

  /**
   * STUB - reject is not implemented. Same status as `approve` above - see
   * docs/dashboard-migration.md §2.3, row 41.
   */
  reject(dto: StatusWithdrawalDto): Promise<void> {
    // TODO(backend): flip status to rejected, per docs/dashboard-migration.md.
    void dto;
    return Promise.resolve();
  }
}
