import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { BaseFeeDto } from './dto/base-fee.dto';

@Injectable()
export class ConfigFeeService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findAllConfig(): Promise<BaseFeeDto[]> {
    const baseFees = await this.prismaSlave.baseFee.findMany({
      where: { deletedAt: null },
      orderBy: [
        { providerName: 'asc' },
        { paymentMethodName: 'asc' },
        { transactionType: 'asc' },
      ],
    });

    return baseFees.map((baseFee) => new BaseFeeDto(baseFee as never));
  }
}
