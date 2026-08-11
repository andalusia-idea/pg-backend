import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { instanceToPlain } from 'class-transformer';
import { ApiError } from '../shared/exception';
import { PROFILE_KIND_BY_ROLE, ROLE } from './auth.constant';
import { AuthHelper } from './auth.helper';
import { AuthDto } from './dto/auth.dto';
import { AuthInfoDto } from './dto/auth-info.dto';
import { LoginDto } from './dto/login.dto';
import { UserRoleEnum } from '@app/microservice';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
    private readonly jwtService: JwtService,
  ) {}

  /** Returns the principal on valid credentials, or null so LocalStrategy can 401. */
  async validateUser(loginDto: LoginDto): Promise<AuthInfoDto | null> {
    const { email, password } = loginDto;

    const user = await this.prismaSlave.user.findFirst({
      where: { email, deletedAt: null },
      include: { role: true },
    });
    if (!user) return null;

    const isPasswordValid = await AuthHelper.verifyPassword(
      user.password,
      password,
    );
    if (!isPasswordValid) return null;

    const role = user.role.name as ROLE;
    const profileId = await this.findProfileIdByUserIdAndRole(user.id, role);

    return new AuthInfoDto({ userId: user.id, profileId, role });
  }

  async login(authInfo: AuthInfoDto): Promise<AuthDto> {
    const token = await this.jwtService.signAsync(instanceToPlain(authInfo));
    return new AuthDto({ token, authInfo });
  }

  private async findProfileIdByUserIdAndRole(
    userId: number,
    role: ROLE,
  ): Promise<number> {
    switch (PROFILE_KIND_BY_ROLE[role]) {
      case UserRoleEnum.ADMIN: {
        const admin = await this.prismaSlave.adminDetail.findFirst({
          where: { userId, deletedAt: null },
          select: { id: true },
        });
        if (!admin) throw ApiError.notFound('Admin profile');
        return admin.id;
      }
      case UserRoleEnum.AGENT: {
        const agent = await this.prismaSlave.agentDetail.findFirst({
          where: { userId, deletedAt: null },
          select: { id: true },
        });
        if (!agent) throw ApiError.notFound('Agent profile');
        return agent.id;
      }
      case UserRoleEnum.MERCHANT: {
        const merchant = await this.prismaSlave.merchantDetail.findFirst({
          where: { userId, deletedAt: null },
          select: { id: true },
        });
        if (!merchant) throw ApiError.notFound('Merchant profile');
        return merchant.id;
      }
      default:
        // SYSTEM / SCHEDULER have no profile row and cannot sign in here.
        throw ApiError.unauthorized(`Role '${role}' cannot sign in`);
    }
  }
}
