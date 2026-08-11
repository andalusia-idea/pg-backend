import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../../shared/exception';
import { PermissionDto } from './dto/permission.dto';

type PermissionRow = {
  id: number;
  action: string;
  subject: string;
  inverted: boolean;
  field: string[];
  conditions: unknown;
  reason: string | null;
  roleId: number | null;
};

@Injectable()
export class PermissionService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findAll(): Promise<PermissionDto[]> {
    const permissions = await this.prismaSlave.permission.findMany({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
    });

    return permissions.map((permission) => this.toDto(permission));
  }

  async findOneThrow(id: number): Promise<PermissionDto> {
    const permission = await this.prismaSlave.permission.findFirst({
      where: { id, deletedAt: null },
    });
    if (!permission) throw ApiError.notFound('Permission');

    return this.toDto(permission);
  }

  private toDto(permission: PermissionRow): PermissionDto {
    return new PermissionDto({
      id: permission.id,
      action: permission.action,
      subject: permission.subject,
      inverted: permission.inverted,
      field: permission.field,
      conditions: (permission.conditions as Record<string, unknown>) ?? null,
      reason: permission.reason,
      roleId: permission.roleId,
    });
  }
}
