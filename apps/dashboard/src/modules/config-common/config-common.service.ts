import { PRISMA_SLAVE_PROVIDER_KEY } from '@app/prisma';
import { PrismaClient, TransactionTypeEnumConfig } from '@dashboard/prisma';
import { Inject, Injectable } from '@nestjs/common';
import { CommonDiv, INTERNAL_PROVIDER_NAME } from './config-common.constant';
import { CommonDto } from './dto/common.dto';
import { FilterCommonDto } from './dto/filter-common.dto';

/** Which transaction type each payment-method div filters on. */
const TRANSACTION_TYPE_BY_DIV: Partial<
  Record<CommonDiv, TransactionTypeEnumConfig>
> = {
  [CommonDiv.PAYMENT_METHOD_PURCHASE]: TransactionTypeEnumConfig.PURCHASE,
  [CommonDiv.PAYMENT_METHOD_TOPUP]: TransactionTypeEnumConfig.TOPUP,
  [CommonDiv.PAYMENT_METHOD_WITHDRAW]: TransactionTypeEnumConfig.WITHDRAW,
  [CommonDiv.PAYMENT_METHOD_DISBURSEMENT]:
    TransactionTypeEnumConfig.DISBURSEMENT,
};

@Injectable()
export class ConfigCommonService {
  constructor(
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  async findManyByDiv(filter: FilterCommonDto): Promise<CommonDto[]> {
    const { div } = filter;

    if (div === CommonDiv.BANK) {
      const banks = await this.prismaSlave.bank.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      });
      return banks.map(
        (bank) => new CommonDto({ name: bank.code, explain: bank.name }),
      );
    }

    if (div === CommonDiv.PROVIDER) {
      // INTERNAL is excluded: it is the house account used for top-ups, not a
      // provider a merchant can be routed to.
      const providers = await this.prismaSlave.provider.findMany({
        where: { deletedAt: null, name: { not: INTERNAL_PROVIDER_NAME } },
        orderBy: { name: 'asc' },
      });
      return providers.map(
        (provider) =>
          new CommonDto({ name: provider.name, explain: provider.name }),
      );
    }

    if (div === CommonDiv.PROVIDER_TOPUP) {
      // Top-ups are always funded internally, so this is a fixed single option
      // rather than a lookup.
      return [
        new CommonDto({
          name: INTERNAL_PROVIDER_NAME,
          explain: INTERNAL_PROVIDER_NAME,
        }),
      ];
    }

    if (div === CommonDiv.PAYMENT_METHOD) {
      const paymentMethods = await this.prismaSlave.paymentMethod.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      });
      return paymentMethods.map((method) => new CommonDto(method));
    }

    // Remaining divs are payment methods filtered by transaction type. Legacy
    // defaulted an unrecognised div to PURCHASE; the div is @IsEnum-validated,
    // so anything reaching here is a known PAYMENT_METHOD_* value.
    const transactionType =
      TRANSACTION_TYPE_BY_DIV[div] ?? TransactionTypeEnumConfig.PURCHASE;

    const paymentMethods = await this.prismaSlave.paymentMethod.findMany({
      where: {
        deletedAt: null,
        transactionTypes: { has: transactionType },
      },
      orderBy: { name: 'asc' },
    });

    return paymentMethods.map((method) => new CommonDto(method));
  }
}
