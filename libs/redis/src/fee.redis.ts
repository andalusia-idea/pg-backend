import { Inject, Injectable, Logger } from '@nestjs/common';
import { REDIS_KEY } from './redis.provider';
import Redis from 'ioredis';
import {
  AGENT_SHAREHOLDER_KEY_PREFIX,
  BASE_FEE_KEY_PREFIX,
  MERCHANT_FEE_KEY_PREFIX,
} from './redis.constant';
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionTypeEnum,
} from '@app/microservice';
import Decimal from 'decimal.js';
import { FeeConfig } from '@app/configuration';

export type BaseFeeRedisDto = {
  id: number;
  feeProviderFixed: Decimal;
  feeProviderPercentage: Decimal;
};

type BaseFeeRedisEntry = {
  id: number;
  feeProviderFixed: string;
  feeProviderPercentage: string;
};

export type MerchantFeeRedisDto = {
  feeInternalFixed: Decimal;
  feeInternalPercentage: Decimal;
  feeAgentFixed: Decimal;
  feeAgentPercentage: Decimal;
};

type MerchantFeeRedisEntry = {
  feeInternalFixed: string;
  feeInternalPercentage: string;
  feeAgentFixed: string;
  feeAgentPercentage: string;
};

export type AgentShareholderRedisDto = {
  agentId: number;
  percentagePerAgent: Decimal;
};

type AgentShareholderRedisEntry = {
  agentId: number;
  percentagePerAgent: string;
};

@Injectable()
export class FeeRedis {
  private readonly logger = new Logger(FeeRedis.name);

  constructor(
    @Inject(REDIS_KEY)
    private readonly redis: Redis,

    private readonly feeConfig: FeeConfig,
  ) {}

  private baseFeeKey(
    providerName: ProviderNameEnum,
    paymentMethodName: PaymentMethodNameEnum,
    transactionType: TransactionTypeEnum,
  ): string {
    return `${BASE_FEE_KEY_PREFIX}:${providerName}:${paymentMethodName}:${transactionType}`;
  }

  private merchantFeeKey(merchantId: number, baseFeeId: number): string {
    return `${MERCHANT_FEE_KEY_PREFIX}:${merchantId}:${baseFeeId}`;
  }

  private agentShareholderKey(merchantId: number): string {
    return `${AGENT_SHAREHOLDER_KEY_PREFIX}:${merchantId}`;
  }

  async getBaseFee(
    providerName: ProviderNameEnum,
    paymentMethodName: PaymentMethodNameEnum,
    transactionType: TransactionTypeEnum,
  ): Promise<BaseFeeRedisDto | null> {
    const key = this.baseFeeKey(
      providerName,
      paymentMethodName,
      transactionType,
    );
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (error) {
      this.logger.warn({ msg: `${key} read failed`, error });
      return null;
    }
    if (!raw) return null;

    try {
      const entry = JSON.parse(raw) as BaseFeeRedisEntry;
      return {
        ...entry,
        feeProviderFixed: new Decimal(entry.feeProviderFixed),
        feeProviderPercentage: new Decimal(entry.feeProviderPercentage),
      };
    } catch (error) {
      this.logger.warn({ msg: `${key} entry unreadable`, error });
      return null;
    }
  }

  async setBaseFee(
    providerName: ProviderNameEnum,
    paymentMethodName: PaymentMethodNameEnum,
    transactionType: TransactionTypeEnum,
    value: BaseFeeRedisDto,
  ): Promise<boolean> {
    const key = this.baseFeeKey(
      providerName,
      paymentMethodName,
      transactionType,
    );
    const entry: BaseFeeRedisEntry = {
      ...value,
      feeProviderFixed: value.feeProviderFixed.toFixed(),
      feeProviderPercentage: value.feeProviderPercentage.toFixed(),
    };
    try {
      const ok = await this.redis.setex(
        key,
        this.feeConfig.BASE_FEE_TTL_SECONDS,
        JSON.stringify(entry),
      );
      return ok === 'OK';
    } catch (error) {
      this.logger.warn({ msg: `${key} write failed`, error });
      return false;
    }
  }

  /// Base Fee only be inserted / updated by developer
  // async deleteBaseFee(
  //   providerName: ProviderNameEnum,
  //   paymentMethodName: PaymentMethodNameEnum,
  //   transactionType: TransactionTypeEnum,
  // ): Promise<number> {
  //   const key = this.baseFeeKey(
  //     providerName,
  //     paymentMethodName,
  //     transactionType,
  //   );
  //   try {
  //     const num = await this.redis.del(key);
  //     return num;
  //   } catch (error) {
  //     this.logger.error({ msg: `${key} delete failed`, error });
  //     return 0;
  //   }
  // }

  async getMerchantFee(
    merchantId: number,
    baseFeeId: number,
  ): Promise<MerchantFeeRedisDto | null> {
    const key = this.merchantFeeKey(merchantId, baseFeeId);
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (error) {
      this.logger.warn({ msg: `${key} read failed`, error });
      return null;
    }
    if (!raw) return null;

    try {
      const entry = JSON.parse(raw) as MerchantFeeRedisEntry;
      return {
        ...entry,
        feeInternalFixed: new Decimal(entry.feeInternalFixed),
        feeInternalPercentage: new Decimal(entry.feeInternalPercentage),
        feeAgentFixed: new Decimal(entry.feeAgentFixed),
        feeAgentPercentage: new Decimal(entry.feeAgentPercentage),
      };
    } catch (error) {
      this.logger.warn({ msg: `${key} entry unreadable`, error });
      return null;
    }
  }

  async setMerchantFee(
    merchantId: number,
    baseFeeId: number,
    value: MerchantFeeRedisDto,
  ): Promise<boolean> {
    const key = this.merchantFeeKey(merchantId, baseFeeId);
    const entry: MerchantFeeRedisEntry = {
      ...value,
      feeInternalFixed: value.feeInternalFixed.toFixed(),
      feeInternalPercentage: value.feeInternalPercentage.toFixed(),
      feeAgentFixed: value.feeAgentFixed.toFixed(),
      feeAgentPercentage: value.feeAgentPercentage.toFixed(),
    };
    try {
      const ok = await this.redis.setex(
        key,
        this.feeConfig.MERCHANT_FEE_TTL_SECONDS,
        JSON.stringify(entry),
      );
      return ok === 'OK';
    } catch (error) {
      this.logger.warn({ msg: `${key} write failed`, error });
      return false;
    }
  }

  async deleteMerchantFee(
    merchantId: number,
    baseFeeId: number,
  ): Promise<number> {
    const key = this.merchantFeeKey(merchantId, baseFeeId);
    try {
      const num = await this.redis.del(key);
      return num;
    } catch (error) {
      this.logger.error({ msg: `${key} delete failed`, error });
      return 0;
    }
  }

  async getAgentShareholder(
    merchantId: number,
  ): Promise<AgentShareholderRedisDto[] | null> {
    const key = this.agentShareholderKey(merchantId);
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (error) {
      this.logger.warn({ msg: `${key} read failed`, error });
      return null;
    }
    if (!raw) return null;

    try {
      const entries = JSON.parse(raw) as AgentShareholderRedisEntry[];
      return entries.map((entry) => {
        return {
          ...entry,
          percentagePerAgent: new Decimal(entry.percentagePerAgent),
        };
      });
    } catch (error) {
      this.logger.warn({ msg: `${key} entry unreadable`, error });
      return null;
    }
  }

  async setAgentShareholder(
    merchantId: number,
    values: AgentShareholderRedisDto[],
  ): Promise<boolean> {
    const key = this.agentShareholderKey(merchantId);
    const entries: AgentShareholderRedisEntry[] = values.map((value) => {
      return {
        ...value,
        percentagePerAgent: value.percentagePerAgent.toFixed(),
      };
    });
    try {
      const ok = await this.redis.setex(
        key,
        this.feeConfig.AGENT_SHAREHOLDER_TTL_SECONDS,
        JSON.stringify(entries),
      );
      return ok === 'OK';
    } catch (error) {
      this.logger.warn({ msg: `${key} write failed`, error });
      return false;
    }
  }

  async deleteAgentShareholder(merchantId: number): Promise<number> {
    const key = this.agentShareholderKey(merchantId);
    try {
      const num = await this.redis.del(key);
      return num;
    } catch (error) {
      this.logger.error({ msg: `${key} delete failed`, error });
      return 0;
    }
  }
}
