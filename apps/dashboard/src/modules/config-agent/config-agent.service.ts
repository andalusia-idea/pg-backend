import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { MerchantDto } from '../merchant-detail/dto/merchant.dto';

@Injectable()
export class ConfigAgentService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  /**
   * Merchants an agent holds a share in.
   *
   * `config.AgentShareholder` holds the relationship, `auth.MerchantDetail` the
   * merchant data. Legacy had to collect the ids from config and then make a TCP
   * call to auth to resolve them; the dashboard spans both schemas, so this is a
   * single query and cannot return a partially-resolved list.
   */
  async findMerchantsByAgentId(agentId: number): Promise<MerchantDto[]> {
    const shareholdings = await this.prismaSlave.agentShareholder.findMany({
      where: { agentId, deletedAt: null },
      select: { merchantId: true },
    });

    const merchantIds = shareholdings.map(
      (shareholding) => shareholding.merchantId,
    );
    if (merchantIds.length === 0) return [];

    // AgentShareholder.merchantId references config.Merchant.id, which is the
    // same value as the merchant's auth.User id.
    const merchants = await this.prismaSlave.merchantDetail.findMany({
      where: { userId: { in: merchantIds }, deletedAt: null },
      include: { user: { select: { id: true, email: true } } },
      orderBy: { businessName: 'asc' },
    });

    return merchants.map(
      (merchant) =>
        new MerchantDto({
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
        }),
    );
  }
}
