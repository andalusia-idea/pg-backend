import {
  FilterProfileProviderDto,
  ProfileProviderDto,
  UserRoleEnum,
} from '@app/microservice';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@config/prisma';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class ProfileProviderService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
  ) {}

  // TODO REDIS
  async findProfileProvider(
    dto: FilterProfileProviderDto,
  ): Promise<ProfileProviderDto> {
    const { userId, userRole, transactionType } = dto;

    /// ADMIN
    if (userRole === UserRoleEnum.ADMIN) {
      return {
        userId,
        userRole,
        providerName: 'default', // TODO default
        paymentMethodName: 'TRANSFERBANK',
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
        providerName: agent.providerName ?? 'default', // TODO default
        paymentMethodName: agent.paymentMethodName ?? 'TRANSFERBANK', // TODO default
      } as ProfileProviderDto;
    }

    /// MERCHANT
    const fee = await this.prismaMaster.merchantFee.findFirstOrThrow({
      where: {
        merchantId: userId,
        baseFee: { transactionType: transactionType },
      },
      select: {
        baseFee: { select: { providerName: true, paymentMethodName: true } },
      },
    });

    return {
      userId,
      userRole,
      providerName: fee.baseFee.providerName,
      paymentMethodName: fee.baseFee.paymentMethodName,
    } as ProfileProviderDto;
  }
}
