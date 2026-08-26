import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { Prisma, PrismaClient, TransactionStatusEnum } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { Page, Pageable, paging } from '../../shared/pagination';
import { mapFeeDetails } from '../transaction-shared';
import { PurchaseTransactionDto } from '../purchase/dto/purchase-transaction.dto';
import { FilterSettlementDto } from './dto/filter-settlement.dto';
import { SettleUnsettledDto } from './dto/settle-unsettled.dto';

@Injectable()
export class SettlementService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  /** Successful purchases that have been settled. */
  findAllSettled(
    pageable: Pageable,
    filter: FilterSettlementDto,
  ): Promise<Page<PurchaseTransactionDto>> {
    return this.findPurchases(pageable, filter, { not: null });
  }

  /**
   * Successful purchases still awaiting settlement - typically because the
   * automatic settlement run did not pick them up.
   */
  findAllUnsettled(
    pageable: Pageable,
    filter: FilterSettlementDto,
  ): Promise<Page<PurchaseTransactionDto>> {
    return this.findPurchases(pageable, filter, null);
  }

  private async findPurchases(
    pageable: Pageable,
    filter: FilterSettlementDto,
    settlementAt: Prisma.PurchaseTransactionWhereInput['settlementAt'],
  ): Promise<Page<PurchaseTransactionDto>> {
    const where: Prisma.PurchaseTransactionWhereInput = {
      deletedAt: null,
      status: TransactionStatusEnum.SUCCESS,
      settlementAt,
    };

    if (filter.merchantId) where.merchantId = filter.merchantId;

    // Legacy applies the range only when both ends are present; a lone `from`
    // or `to` is ignored rather than being treated as an open-ended bound.
    if (filter.from && filter.to) {
      where.createdAt = { gte: filter.from, lte: filter.to };
    }

    const { skip, take } = paging(pageable);

    const [total, items] = await this.prismaSlave.$transaction([
      this.prismaSlave.purchaseTransaction.count({ where }),
      this.prismaSlave.purchaseTransaction.findMany({
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

      return new PurchaseTransactionDto({
        ...item,
        metadata: item.metadata as Record<string, unknown> | null,
        totalFeeCut,
        feeDetails,
      } as unknown as PurchaseTransactionDto);
    });

    return new Page<PurchaseTransactionDto>({ pageable, total, data });
  }

  /**
   * STUB - marking a batch of unsettled purchases as settled is not
   * implemented yet. Wired up so the frontend can integrate against the real
   * request/response shape now; the real settlement write (stamping
   * `settlementAt` per row) is a separate scope. See
   * docs/dashboard-migration.md §2.4, row 48.
   */
  settle(dto: SettleUnsettledDto): Promise<void> {
    // TODO(backend): stamp settlementAt on the given ids, per docs/dashboard-migration.md.
    void dto;
    return Promise.resolve();
  }
}
