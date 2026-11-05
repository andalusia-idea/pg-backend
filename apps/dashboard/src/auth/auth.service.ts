import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { instanceToPlain } from 'class-transformer';
import { ApiError } from '../shared/exception';
import { PROFILE_KIND_BY_ROLE, ROLE } from './auth.constant';
import { AuthHelper } from './auth.helper';
import { AuthDto } from './dto/auth.dto';
import { AuthInfoDto } from './dto/auth-info.dto';
import { LoginDto } from './dto/login.dto';
import {
  NAMED_PRINCIPAL_USER_ID,
  UNSET_PASSWORD,
  UserRoleEnum,
} from '@app/microservice';
import { PrincipalConfig } from '@app/configuration';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
    private readonly jwtService: JwtService,
    private readonly principalConfig: PrincipalConfig,
  ) {}

  /** Returns the principal on valid credentials, or null so LocalStrategy can 401. */
  async validateUser(loginDto: LoginDto): Promise<AuthInfoDto | null> {
    const { email, password } = loginDto;

    const user = await this.prismaSlave.user.findFirst({
      where: { email, deletedAt: null },
      include: { role: true },
    });
    if (!user) return null;

    // An unactivated named principal: the migration wrote a sentinel instead of
    // a hash, so there is nothing for argon2 to verify against and the
    // provisioning password from the environment stands in for one login.
    //
    // The two branches are disjoint on purpose. Falling through to
    // verifyPassword on a failed activation would work - argon2 rejects the
    // sentinel - but it would also mean the provisioning path is reachable from
    // the normal path, and the whole point of UNSET_PASSWORD being a distinct
    // string from LOCKED_MACHINE_PASSWORD is that those two paths never meet.
    if (user.password === UNSET_PASSWORD) {
      return this.activateNamedPrincipal(user, password);
    }

    const isPasswordValid = await AuthHelper.verifyPassword(
      user.password,
      password,
    );
    if (!isPasswordValid) return null;

    const role = user.role.name as ROLE;
    const profileId = await this.findProfileIdByUserIdAndRole(user.id, role);

    return new AuthInfoDto({ userId: user.id, profileId, role });
  }

  /**
   * Signs in a named principal that still carries UNSET_PASSWORD, by comparing
   * the submitted password against the provisioning password in the
   * environment.
   *
   * Only ids 21 and 22 have one. Anything else holding the sentinel - a row
   * hand-edited, restored from a dump, or a machine principal whose password
   * column was tampered with - gets null, because
   * `provisioningPasswordFor` has nothing to offer it.
   */
  private async activateNamedPrincipal(
    user: { id: number; role: { name: string } },
    password: string,
  ): Promise<AuthInfoDto | null> {
    let provisioningPassword: string;
    try {
      const configured = this.provisioningPasswordFor(user.id);
      if (configured === null) return null;
      provisioningPassword = configured;
    } catch (error) {
      // PrincipalConfig throws when the key is missing, or set to something it
      // refuses in production. That is a deployment fault, not a credential
      // fault: log it so it is findable, and still answer 401 rather than
      // telling an anonymous caller that the server is misconfigured.
      this.logger.error(
        `Named principal ${user.id} is unactivated and its provisioning ` +
          `password is unusable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    if (!AuthHelper.secretEquals(provisioningPassword, password)) return null;

    // Role and profile are read, never assumed. The migration asserts this
    // account's roleId, so reading it costs nothing and cannot drift; and the
    // detail row's id is left to the sequence by that same migration, so there
    // is no constant to hardcode it from. It happens to be 1 on a database
    // seeded in the usual order, which is precisely what makes hardcoding it
    // dangerous - it would pass every local test and sign a wrong profileId
    // into the JWT on a restored or differently-ordered database.
    const role = user.role.name as ROLE;
    const profileId = await this.findProfileIdByUserIdAndRole(user.id, role);

    this.logger.warn(
      `Named principal ${user.id} signed in with its provisioning password. ` +
        `Reset it via POST /super-admin/reset-password.`,
    );

    return new AuthInfoDto({ userId: user.id, profileId, role });
  }

  /** The provisioning password for a named principal, or null for anything else. */
  private provisioningPasswordFor(userId: number): string | null {
    switch (userId) {
      case NAMED_PRINCIPAL_USER_ID.SUPER_ADMIN:
        return this.principalConfig.INITIAL_SUPER_ADMIN_PASSWORD;
      case NAMED_PRINCIPAL_USER_ID.AGENT_INTERNAL:
        return this.principalConfig.INITIAL_AGENT_INTERNAL_PASSWORD;
      default:
        return null;
    }
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
