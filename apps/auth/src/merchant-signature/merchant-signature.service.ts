import {
  FilterMerchantWebhookUrlDto,
  MerchantWebhookUrlDto,
} from '@app/microservice';
import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { PrismaClient } from '@auth/prisma';
import { Inject, Injectable } from '@nestjs/common';

// TODO redis
@Injectable()
export class MerchantSignatureService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findMerchantWebhookUrl(dto: FilterMerchantWebhookUrlDto) {
    const { userId } = dto;
    const merchantSignature =
      await this.prismaMaster.merchantSignature.findUniqueOrThrow({
        where: { userId: userId },
        select: {
          payinUrl: true,
          payoutUrl: true,
        },
      });

    return {
      payinUrl: merchantSignature.payinUrl,
      payoutUrl: merchantSignature.payoutUrl,
    } as MerchantWebhookUrlDto;
  }
}
