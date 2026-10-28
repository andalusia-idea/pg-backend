import {
  FilterProfileProviderDto,
  PaymentMethodNameEnum,
  ProfileProviderDto,
  ProviderNameEnum,
  UserRoleEnum,
} from '@app/microservice';
import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { PrismaClient } from '@config/prisma';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class ProfileProviderService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findProfileProvider(
    dto: FilterProfileProviderDto,
  ): Promise<ProfileProviderDto> {
    const { userId, userRole, transactionType, paymentMethodName } = dto;

    /// ADMIN
    if (userRole === UserRoleEnum.ADMIN) {
      return {
        userId,
        userRole,
        providerName: ProviderNameEnum.INTERNAL,
        paymentMethodName: PaymentMethodNameEnum.TRANSFERBANK,
      } as ProfileProviderDto;
    }

    /// AGENT
    if (userRole === UserRoleEnum.AGENT) {
      const agent = await this.prismaMaster.agent.findUniqueOrThrow({
        where: { id: userId },
      });
      return {
        userId,
        userRole,
        providerName: agent.providerName ?? ProviderNameEnum.INTERNAL,
        paymentMethodName:
          agent.paymentMethodName ?? PaymentMethodNameEnum.TRANSFERBANK,
      } as ProfileProviderDto;
    }

    /// MERCHANT
    const fee = await this.prismaMaster.merchantFee.findFirstOrThrow({
      where: {
        merchantId: userId,
        deletedAt: null,
        baseFee: {
          paymentMethodName: paymentMethodName,
          transactionType: transactionType,
          isActive: true,
          deletedAt: null,
        },
      },
      select: {
        baseFee: { select: { providerName: true, paymentMethodName: true } },
      },
    });

    const res: ProfileProviderDto = {
      providerName: fee.baseFee.providerName as ProviderNameEnum,
    };
    return res;
  }
}
