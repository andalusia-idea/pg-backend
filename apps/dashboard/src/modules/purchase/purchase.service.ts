import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { Prisma, PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { Page, Pageable, paging } from '../../shared/pagination';
import {
  FilterTransactionDto,
  mapFeeDetails,
  resolveDateRange,
} from '../transaction-shared';
import { PurchaseTransactionDto } from './dto/purchase-transaction.dto';

@Injectable()
export class PurchaseService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findAll(
    pageable: Pageable,
    filter: FilterTransactionDto,
  ): Promise<Page<PurchaseTransactionDto>> {
    const where: Prisma.PurchaseTransactionWhereInput = {
      deletedAt: null,
      createdAt: resolveDateRange(filter.from, filter.to),
    };

    if (filter.merchantId) where.merchantId = filter.merchantId;
    if (filter.providerName) where.providerName = filter.providerName;
    if (filter.paymentMethodName) {
      where.paymentMethodName = filter.paymentMethodName;
    }
    if (filter.status) where.status = filter.status;

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
}
