import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { AuthHelper } from '../../auth/auth.helper';
import { AuthInfoDto } from '../../auth/dto/auth-info.dto';
import { CreateAgentDto } from './dto/create-agent.dto';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import {
  MerchantSignatureStatusEnum,
  ROLE_ID,
  SettlementModeEnum,
} from '@app/microservice';
import { generateClientId } from '@app/signature';

@Injectable()
export class UserService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
  ) {}

  /**
   * Creates the auth-side user + merchant detail + signature, and the
   * config-side merchant row, in a single transaction.
   *
   * Legacy split this across two services: auth wrote its own tables, then made
   * a TCP call to config to create the merchant config row. That call happened
   * after the auth transaction committed, so a config failure left an orphaned
   * user with no merchant config. The dashboard spans both schemas, so the whole
   * thing is one atomic unit.
   */
  async registerMerchant(
    authInfo: AuthInfoDto,
    dto: CreateMerchantDto,
  ): Promise<void> {
    const hashedPassword = await AuthHelper.hashPassword(dto.password);

    await this.prismaMaster.$transaction(async (tx) => {
      // `ROLE_ID` rather than a lookup by name: the `machine_principals`
      // migration pins every role id and refuses to complete if they disagree,
      // so there is nothing left for a query to discover. See Step 7.2 of
      // docs/batch/settlement-batching-implementation.md.
      const user = await tx.user.create({
        data: {
          roleId: ROLE_ID.MERCHANT,
          email: dto.email,
          password: hashedPassword,
        },
        select: { id: true },
      });

      await tx.merchantDetail.create({
        data: {
          userId: user.id,
          ownerName: dto.ownerName,
          businessName: dto.businessName,
          brandName: dto.brandName,
          phoneNumber: dto.phoneNumber,
          nik: dto.nik,
          ktpImage: dto.ktpImage,
          npwp: dto.npwp,
          address: dto.address,
          province: dto.province,
          regency: dto.regency,
          district: dto.district,
          village: dto.village,
          postalCode: dto.postalCode,
          bankCode: dto.bankCode,
          bankName: dto.bankName,
          accountNumber: dto.accountNumber,
          accountHolderName: dto.accountHolderName,
          siupFile: dto.siupFile,
          coordinate: dto.coordinate,
        },
      });

      await tx.merchantSignature.create({
        data: {
          userId: user.id,
          clientId: generateClientId(),
          status: MerchantSignatureStatusEnum.ACTIVE,
        },
      });

      // config.Merchant shares the auth user's id as its primary key.
      await tx.merchant.create({
        data: {
          id: user.id,
        },
      });

      await tx.merchantSettlementPolicy.create({
        data: {
          merchantId: user.id,
          paymentMethodName: '*',
          mode: SettlementModeEnum.FOLLOW_UPSTREAM,
          effectiveFrom: new Date(),
        },
      });

      // Merchants are onboarded by their agent (the internal team signs in as
      // an "AgentInternal" agent to do it), so this normally holds and the
      // shareholder row is always created. The check stays because @Roles() is
      // not enforced yet - without it, a non-agent caller would hit a foreign
      // key violation on agentId instead of simply not getting a shareholder.
      const registrarIsAgent = await tx.agent.findUnique({
        where: { id: authInfo.userId },
        select: { id: true },
      });
      if (registrarIsAgent) {
        await tx.agentShareholder.create({
          data: {
            agentId: authInfo.userId,
            merchantId: user.id,
            percentagePerAgent: 0,
          },
        });
      }
    });
  }

  /** Same atomicity note as registerMerchant: auth + config rows in one transaction. */
  async registerAgent(dto: CreateAgentDto): Promise<void> {
    const hashedPassword = await AuthHelper.hashPassword(dto.password);

    await this.prismaMaster.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          roleId: ROLE_ID.AGENT,
          email: dto.email,
          password: hashedPassword,
        },
        select: { id: true },
      });

      await tx.agentDetail.create({
        data: {
          userId: user.id,
          fullname: dto.fullname,
          address: dto.address,
          phone: dto.phone,
          bankCode: dto.bankCode,
          bankName: dto.bankName,
          accountNumber: dto.accountNumber,
          accountHolderName: dto.accountHolderName,
        },
      });

      // config.Agent shares the auth user's id as its primary key.
      await tx.agent.create({ data: { id: user.id } });
    });
  }
}
