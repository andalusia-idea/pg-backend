import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { Prisma, PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { Page, Pageable, paging } from '../../shared/pagination';
import {
  FilterTransactionDto,
  mapFeeDetails,
  resolveDateRange,
} from '../transaction-shared';
import { DisbursementCallbackActionDto } from './dto/disbursement-callback-action.dto';
import { DisbursementTransactionDto } from './dto/disbursement-transaction.dto';

@Injectable()
export class DisbursementService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findAll(
    pageable: Pageable,
    filter: FilterTransactionDto,
  ): Promise<Page<DisbursementTransactionDto>> {
    const where: Prisma.DisbursementTransactionWhereInput = {
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
      this.prismaSlave.disbursementTransaction.count({ where }),
      this.prismaSlave.disbursementTransaction.findMany({
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

      return new DisbursementTransactionDto({
        ...item,
        metadata: item.metadata as Record<string, unknown> | null,
        totalFeeCut,
        feeDetails,
      } as unknown as DisbursementTransactionDto);
    });

    return new Page<DisbursementTransactionDto>({ pageable, total, data });
  }

  /**
   * STUB - none of the three provider-callback actions below are implemented
   * yet. Wired up so the frontend can integrate against the real
   * request/response shape now; the actual provider-integration work is a
   * separate scope. See docs/dashboard-migration.md §2.3, rows 45-47.
   */
  resendCallback(dto: DisbursementCallbackActionDto): Promise<void> {
    // TODO(backend): re-fire the provider webhook callback for this disbursement.
    void dto;
    return Promise.resolve();
  }

  refreshStatus(dto: DisbursementCallbackActionDto): Promise<void> {
    // TODO(backend): re-poll the provider for this disbursement's current status.
    void dto;
    return Promise.resolve();
  }

  notifyMerchant(dto: DisbursementCallbackActionDto): Promise<void> {
    // TODO(backend): re-send this disbursement's webhook to the merchant's payoutUrl.
    void dto;
    return Promise.resolve();
  }
}
