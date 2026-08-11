import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { Prisma, PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { AuthHelper } from '../../auth/auth.helper';
import { ApiError } from '../../shared/exception';
import { DtoHelper } from '../../shared/helper';
import { Page, Pageable, paging } from '../../shared/pagination';
import { FilterMerchantDetailDto } from './dto/filter-merchant-detail.dto';
import { MerchantDto, MerchantNameDto } from './dto/merchant.dto';
import { UpdateMerchantDetailDto } from './dto/update-merchant-detail.dto';

type MerchantDetailWithUser = Prisma.MerchantDetailModel & {
  user: { id: number; email: string };
};

@Injectable()
export class MerchantDetailService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findAll(
    pageable: Pageable,
    filter: FilterMerchantDetailDto,
  ): Promise<Page<MerchantDto>> {
    const where: Prisma.MerchantDetailWhereInput = { deletedAt: null };

    if (filter.businessName) {
      where.businessName = {
        contains: filter.businessName,
        mode: 'insensitive',
      };
    }

    const { skip, take } = paging(pageable);

    const [total, items] = await this.prismaSlave.$transaction([
      this.prismaSlave.merchantDetail.count({ where }),
      this.prismaSlave.merchantDetail.findMany({
        where,
        include: { user: { select: { id: true, email: true } } },
        orderBy: { id: 'asc' },
        skip,
        take,
      }),
    ]);

    return new Page<MerchantDto>({
      pageable,
      total,
      data: items.map((merchant) => this.toDto(merchant)),
    });
  }

  async findAllNames(): Promise<MerchantNameDto[]> {
    const merchants = await this.prismaSlave.merchantDetail.findMany({
      where: { deletedAt: null },
      select: { id: true, userId: true, businessName: true },
      orderBy: { businessName: 'asc' },
    });

    return merchants.map(
      (merchant) =>
        new MerchantNameDto({
          userId: merchant.userId,
          profileId: merchant.id,
          businessName: merchant.businessName,
        }),
    );
  }

  async findOneThrow(userId: number): Promise<MerchantDto> {
    const merchant = await this.prismaSlave.merchantDetail.findFirst({
      where: { userId, deletedAt: null },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!merchant) throw ApiError.notFound('Merchant');

    return this.toDto(merchant);
  }

  /**
   * `email` / `password` belong to auth.User, everything else to
   * auth.MerchantDetail, so both tables are written in one transaction.
   */
  async update(userId: number, dto: UpdateMerchantDetailDto): Promise<void> {
    const { email, password, ...detail } = dto;

    const detailData: Record<string, unknown> = DtoHelper.filter(detail);
    const userData: Record<string, unknown> = DtoHelper.filter({
      email,
      password,
    });

    if (typeof userData.password === 'string') {
      userData.password = await AuthHelper.hashPassword(userData.password);
    }

    await this.prismaMaster.$transaction(async (tx) => {
      const merchant = await tx.merchantDetail.findFirst({
        where: { userId, deletedAt: null },
        select: { id: true },
      });
      if (!merchant) throw ApiError.notFound('Merchant');

      if (Object.keys(detailData).length > 0) {
        await tx.merchantDetail.update({ where: { userId }, data: detailData });
      }

      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userData });
      }
    });
  }

  private toDto(merchant: MerchantDetailWithUser): MerchantDto {
    return new MerchantDto({
      userId: merchant.user.id,
      profileId: merchant.id,
      email: merchant.user.email,
      ownerName: merchant.ownerName,
      businessName: merchant.businessName,
      brandName: merchant.brandName,
      phoneNumber: merchant.phoneNumber,
      nik: merchant.nik,
      ktpImage: merchant.ktpImage,
      npwp: merchant.npwp,
      address: merchant.address,
      province: merchant.province,
      regency: merchant.regency,
      district: merchant.district,
      village: merchant.village,
      postalCode: merchant.postalCode,
      bankCode: merchant.bankCode,
      bankName: merchant.bankName,
      accountNumber: merchant.accountNumber,
      accountHolderName: merchant.accountHolderName,
      siupFile: merchant.siupFile,
      coordinate: merchant.coordinate,
    });
  }
}
