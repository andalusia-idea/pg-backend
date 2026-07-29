import {
  FilterDisbursementFeeDto,
  AgentFeeEachDto,
  AgentFeeDto,
  ProviderFeeDto,
  InternalFeeDto,
  MerchantFeeDto,
  DisbursementFeeDto,
} from '@app/microservice';
import {
  PRISMA_MASTER_PROVIDER_KEY,
  PRISMA_SLAVE_PROVIDER_KEY,
} from '@app/prisma';
import { PrismaClient, TransactionTypeEnum } from '@config/prisma';
import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

@Injectable()
export class DisbursementFeeService {
  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
    @Inject(PRISMA_SLAVE_PROVIDER_KEY)
    private readonly prismaSlave: PrismaClient,
  ) {}

  private readonly transactionType = TransactionTypeEnum.DISBURSEMENT;

  async calculate(dto: FilterDisbursementFeeDto): Promise<DisbursementFeeDto> {
    const {
      merchantId,
      nominal: nominalString,
      providerName,
      paymentMethodName,
    } = dto;

    const nominal = new Decimal(nominalString);

    /**
     * Find Base Fee
     */
    const baseFee = await this.prismaMaster.baseFee.findFirstOrThrow({
      where: {
        providerName,
        paymentMethodName,
        transactionType: this.transactionType,
      },
    });
    console.log({ baseFee });

    /**
     * Provider Fee Calculate
     */
    const feeProviderTotal = new Decimal(0)
      .plus(baseFee.feeProviderFixed)
      .plus(nominal.times(baseFee.feeProviderPercentage.dividedBy(100)));
    console.log({ feeProviderTotal });

    /**
     * Find Merchant Fee
     */
    const merchantFee = await this.prismaMaster.merchantFee.findUniqueOrThrow({
      where: {
        merchantId_baseFeeId: {
          merchantId,
          baseFeeId: baseFee.id,
        },
      },
    });
    console.log({ merchantFee });

    /**
     * Internal Fee Calculate
     */
    const feeInternalTotal = new Decimal(0)
      .plus(merchantFee.feeInternalFixed)
      .plus(nominal.times(merchantFee.feeInternalPercentage.dividedBy(100)));

    console.log({ feeInternalTotal });

    /**
     * Agent Related to Merchant
     * If fee agent equals to zero then it means merchant do not have an agent
     */
    const isMerchantHaveAgents =
      !merchantFee.feeAgentFixed.equals(new Decimal(0)) ||
      !merchantFee.feeAgentPercentage.equals(new Decimal(0));
    console.log({ isMerchantHaveAgents });

    /**
     * Agent Fee Total Calculate
     */
    const feeAgentTotal = new Decimal(0)
      .plus(merchantFee.feeAgentFixed)
      .plus(nominal.times(merchantFee.feeAgentPercentage.dividedBy(100)));
    console.log({ feeAgentTotal });

    /**
     * Find Agent Shareholder based on Merchant and Calculate Nominal each Agent
     */
    const agentDtos: AgentFeeEachDto[] = [];
    if (isMerchantHaveAgents) {
      const shareholders = await this.prismaMaster.agentShareholder.findMany({
        where: { merchantId },
      });
      agentDtos.push(
        ...shareholders.map((shareholder) => {
          return {
            agentId: shareholder.agentId,
            nominal: feeAgentTotal
              .times(shareholder.percentagePerAgent.dividedBy(100))
              .toFixed(2),
            feePercentage: shareholder.percentagePerAgent.toFixed(2),
          } as AgentFeeEachDto;
        }),
      );
    }

    /**
     * Merchant Fee Calculate
     */
    // Calculate merchant net amount
    const merchantNetAmount = nominal
      .plus(feeProviderTotal)
      .plus(feeInternalTotal)
      .plus(feeAgentTotal);

    // Calculate merchant percentage
    const merchantPercentage = merchantNetAmount.dividedBy(nominal).times(100);

    console.log({ merchantNetAmount, merchantPercentage });

    /**
     * DTO
     */
    const providerFeeDto: ProviderFeeDto = {
      name: providerName,
      nominal: feeProviderTotal.toFixed(2),
      feeFixed: baseFee.feeProviderFixed.toFixed(2),
      feePercentage: baseFee.feeProviderPercentage.toFixed(2),
    };
    const internalFeeDto: InternalFeeDto = {
      nominal: feeInternalTotal.toFixed(2),
      feeFixed: merchantFee.feeInternalFixed.toFixed(2),
      feePercentage: merchantFee.feeInternalPercentage.toFixed(2),
    };
    const agentFeeDto: AgentFeeDto = {
      nominal: feeAgentTotal.toFixed(2),
      feeFixed: merchantFee.feeAgentFixed.toFixed(2),
      feePercentage: merchantFee.feeAgentPercentage.toFixed(2),
      agents: agentDtos,
    };
    const merchantFeeDto: MerchantFeeDto = {
      merchantId: merchantId,
      netNominal: merchantNetAmount.toFixed(2),
      nominal: nominal.toFixed(2),
      feePercentage: merchantPercentage.toFixed(2),
    };

    return {
      providerFee: providerFeeDto,
      internalFee: internalFeeDto,
      agentFee: agentFeeDto,
      merchantFee: merchantFeeDto,
    } as DisbursementFeeDto;
  }
}
