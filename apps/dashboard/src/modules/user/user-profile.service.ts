import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { UserRoleEnum } from '@app/microservice';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { PROFILE_KIND_BY_ROLE } from '../../auth/auth.constant';
import { AuthInfoDto } from '../../auth/dto/auth-info.dto';
import { ApiError } from '../../shared/exception';
import {
  ProfileAdminDetailDto,
  ProfileAgentDetailDto,
  ProfileDto,
  ProfileMerchantDetailDto,
} from './dto/profile.dto';

@Injectable()
export class UserProfileService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  /** The caller's own profile, shaped by their role. */
  async profile(authInfo: AuthInfoDto): Promise<ProfileDto> {
    const { userId, role } = authInfo;

    const user = await this.prismaSlave.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!user) throw ApiError.notFound('User');

    const base = { userId: user.id, email: user.email };

    switch (PROFILE_KIND_BY_ROLE[role]) {
      case UserRoleEnum.AGENT: {
        const detail = await this.prismaSlave.agentDetail.findFirst({
          where: { userId, deletedAt: null },
        });
        if (!detail) throw ApiError.notFound('Agent profile');

        return new ProfileDto({
          ...base,
          profileId: detail.id,
          agent: new ProfileAgentDetailDto(detail),
        });
      }

      case UserRoleEnum.MERCHANT: {
        const detail = await this.prismaSlave.merchantDetail.findFirst({
          where: { userId, deletedAt: null },
        });
        if (!detail) throw ApiError.notFound('Merchant profile');

        return new ProfileDto({
          ...base,
          profileId: detail.id,
          merchant: new ProfileMerchantDetailDto(detail),
        });
      }

      case UserRoleEnum.ADMIN: {
        const detail = await this.prismaSlave.adminDetail.findFirst({
          where: { userId, deletedAt: null },
        });
        if (!detail) throw ApiError.notFound('Admin profile');

        return new ProfileDto({
          ...base,
          profileId: detail.id,
          admin: new ProfileAdminDetailDto(detail),
        });
      }

      default:
        // Legacy fell through to the admin branch for any unmapped role, which
        // would 500 on a SYSTEM/SCHEDULER token rather than saying why.
        throw ApiError.forbidden(`Role '${role}' has no dashboard profile`);
    }
  }
}
