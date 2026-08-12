import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { AuthHelper } from '../../auth/auth.helper';
import { ApiError } from '../../shared/exception';
import { DtoHelper } from '../../shared/helper';
import { AgentDto, AgentNameDto } from './dto/agent.dto';
import { UpdateAgentDetailDto } from './dto/update-agent-detail.dto';

type AgentDetailWithUser = {
  id: number;
  fullname: string;
  address: string;
  phone: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  user: { id: number; email: string };
};

@Injectable()
export class AgentDetailService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findAll(): Promise<AgentDto[]> {
    const agents = await this.prismaSlave.agentDetail.findMany({
      where: { deletedAt: null },
      include: { user: { select: { id: true, email: true } } },
      orderBy: { id: 'asc' },
    });

    return agents.map((agent) => this.toDto(agent));
  }

  async findAllNames(): Promise<AgentNameDto[]> {
    const agents = await this.prismaSlave.agentDetail.findMany({
      where: { deletedAt: null },
      select: { id: true, userId: true, fullname: true },
      orderBy: { fullname: 'asc' },
    });

    return agents.map(
      (agent) =>
        new AgentNameDto({
          userId: agent.userId,
          profileId: agent.id,
          fullname: agent.fullname,
        }),
    );
  }

  async findOneThrow(userId: number): Promise<AgentDto> {
    const agent = await this.prismaSlave.agentDetail.findFirst({
      where: { userId, deletedAt: null },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!agent) throw ApiError.notFound('Agent');

    return this.toDto(agent);
  }

  /**
   * `email` / `password` belong to auth.User, everything else to
   * auth.AgentDetail, so both tables are written in one transaction.
   */
  async update(userId: number, dto: UpdateAgentDetailDto): Promise<void> {
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
      const agent = await tx.agentDetail.findFirst({
        where: { userId, deletedAt: null },
        select: { id: true },
      });
      if (!agent) throw ApiError.notFound('Agent');

      if (Object.keys(detailData).length > 0) {
        await tx.agentDetail.update({
          where: { userId },
          data: detailData,
        });
      }

      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: userId }, data: userData });
      }
    });
  }

  private toDto(agent: AgentDetailWithUser): AgentDto {
    return new AgentDto({
      userId: agent.user.id,
      profileId: agent.id,
      email: agent.user.email,
      fullname: agent.fullname,
      address: agent.address,
      phone: agent.phone,
      bankCode: agent.bankCode,
      bankName: agent.bankName,
      accountNumber: agent.accountNumber,
      accountHolderName: agent.accountHolderName,
    });
  }
}
