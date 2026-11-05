import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { CreateAdminDto, ResetPasswordDto } from './dto';
import { AuthHelper } from '../auth';
import {
  LOCKED_MACHINE_PASSWORD,
  MACHINE_USER_ID,
  ROLE_ID,
} from '@app/microservice';
import { ApiError } from '../shared/exception';

@Injectable()
export class SuperAdminService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
  ) {}

  async registerAdmin(dto: CreateAdminDto) {
    const hashedPassword = await AuthHelper.hashPassword(dto.password);

    await this.prismaMaster.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          roleId: ROLE_ID.ADMIN,
          email: dto.email,
          password: hashedPassword,
        },
        select: { id: true },
      });

      await tx.adminDetail.create({
        data: {
          userId: user.id,
          fullname: dto.fullname,
          address: dto.address,
          phone: dto.phone,
        },
      });
    });
  }

  /**
   * Sets any account's password. This is the activation step for the two named
   * principals - the first thing to run after a production cutover, which
   * replaces their UNSET_PASSWORD sentinel with a real argon2 hash and retires
   * INITIAL_SUPER_ADMIN_PASSWORD / INITIAL_AGENT_INTERNAL_PASSWORD as live
   * credentials.
   *
   * Machine principals are refused. Ids 1-20 are pinned by
   * `20261009090000_machine_principals` with LOCKED_MACHINE_PASSWORD, a value
   * no argon2 verification accepts, and that is the whole of what makes them
   * unable to sign in. A migration can pin a row but cannot stop an API from
   * updating it afterwards, so without this check one call here would turn a
   * locked system account into a working login - and SYSTEM_01 is the id that
   * stamps `createdBy` on engine data.
   */
  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prismaMaster.user.findFirst({
      where: { email: dto.email, deletedAt: null },
      select: { id: true, password: true },
    });
    if (!user) throw ApiError.notFound('User');

    // Checked two ways on purpose. The id band is the rule; the stored sentinel
    // catches a machine principal that somehow sits outside it, and costs one
    // comparison.
    if (
      user.id <= MACHINE_USER_ID.SCHEDULER_10 ||
      user.password === LOCKED_MACHINE_PASSWORD
    ) {
      throw ApiError.forbidden(
        `User ${user.id} is a machine principal and cannot be given a password`,
      );
    }

    const hashedPassword = await AuthHelper.hashPassword(dto.password);

    await this.prismaMaster.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });
  }
}
