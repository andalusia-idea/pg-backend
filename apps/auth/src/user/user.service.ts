import {
  FilterProfileBankDto,
  ProfileBankDto,
  UserRoleEnum,
} from '@app/microservice';
import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { PrismaClient } from '@auth/prisma';
import { Inject, Injectable } from '@nestjs/common';

// TODO redis
@Injectable()
export class UserService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findProfileBank(dto: FilterProfileBankDto): Promise<ProfileBankDto> {
    const { userId } = dto;
    const user = await this.prismaMaster.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: { select: { name: true } } },
    });
    const role = user.role.name;

    if (role.startsWith(UserRoleEnum.MERCHANT)) {
      const merchant = await this.prismaMaster.merchantDetail.findUniqueOrThrow(
        {
          where: { userId: userId },
          select: {
            id: true,
            bankCode: true,
            bankName: true,
            accountNumber: true,
            accountHolderName: true,
          },
        },
      );

      return {
        userId: userId,
        profileId: merchant.id,
        userRole: UserRoleEnum.MERCHANT,
        bankCode: merchant.bankCode,
        bankName: merchant.bankName,
        accountNumber: merchant.accountNumber,
        accountHolderName: merchant.accountHolderName,
      } as ProfileBankDto;
    }

    if (role.startsWith(UserRoleEnum.AGENT)) {
      const agent = await this.prismaMaster.agentDetail.findUniqueOrThrow({
        where: { userId: userId },
        select: {
          id: true,
          bankCode: true,
          bankName: true,
          accountNumber: true,
          accountHolderName: true,
        },
      });
      return {
        userId: userId,
        profileId: agent.id,
        userRole: UserRoleEnum.AGENT,
        bankCode: agent.bankCode,
        bankName: agent.bankName,
        accountNumber: agent.accountNumber,
        accountHolderName: agent.accountHolderName,
      } as ProfileBankDto;
    }

    const admin = await this.prismaMaster.adminDetail.findUniqueOrThrow({
      where: { userId: userId },
      select: { id: true },
    });

    return {
      userId: userId,
      profileId: admin.id,
      userRole: UserRoleEnum.ADMIN,
      bankCode: 'default',
      bankName: 'default',
      accountNumber: 'default',
      accountHolderName: 'default',
    } as ProfileBankDto;
  }
}
