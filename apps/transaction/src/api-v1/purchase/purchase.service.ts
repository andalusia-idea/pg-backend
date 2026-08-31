import {
  FeeCalculateConfigClient,
  MerchantSignatureAuthClient,
  ProfileClient,
} from '@app/microservice';
import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@transaction/prisma';
import { CreateQrisRequestDto } from './purchase.dto';

@Injectable()
export class PurchaseService {
  private readonly logger = new Logger(PurchaseService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,

    private readonly feeCalculateClient: FeeCalculateConfigClient,
    private readonly merchantSignatureClient: MerchantSignatureAuthClient,
    private readonly profileClient: ProfileClient,
  ) {}

  async createQRIS(dto: CreateQrisRequestDto) {}
}
