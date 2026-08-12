import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateProperty,
  ApiMoneyProperty,
  ApiPercentageProperty,
  ToJakartaISONullable,
  ToMoneyString,
  ToPercentageString,
} from '../../../shared/decorator';
import { DtoHelper } from '../../../shared/helper';
import { BaseFeeDto } from '../../config-fee/dto/base-fee.dto';

export class AgentShareholderDto {
  constructor(data: AgentShareholderDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  agentId: number;

  @ApiPercentageProperty()
  @ToPercentageString()
  percentagePerAgent: string;
}

/** A merchant's override of the provider-level base fee. */
export class MerchantFeeDto {
  constructor(data: MerchantFeeDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  id: number;

  @ApiProperty()
  baseFeeId: number;

  @ApiMoneyProperty()
  @ToMoneyString()
  feeInternalFixed: string;

  @ApiPercentageProperty()
  @ToPercentageString()
  feeInternalPercentage: string;

  @ApiMoneyProperty()
  @ToMoneyString()
  feeAgentFixed: string;

  @ApiPercentageProperty()
  @ToPercentageString()
  feeAgentPercentage: string;
}

/** One base fee paired with this merchant's override, if any. */
export class MerchantBaseFeeConfigDto {
  constructor(data: MerchantBaseFeeConfigDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty({ type: BaseFeeDto })
  baseFeeConfig: BaseFeeDto;

  @ApiProperty({ type: MerchantFeeDto, required: false, nullable: true })
  merchantFeeConfig: MerchantFeeDto | null;
}

export class MerchantConfigDto {
  constructor(data: MerchantConfigDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty({ description: 'Minutes between settlement runs' })
  settlementInterval: number;

  @ApiDateProperty({ required: false, nullable: true })
  @ToJakartaISONullable()
  lastSettlementAt: string | null;

  @ApiProperty({
    type: AgentShareholderDto,
    isArray: true,
    required: false,
    nullable: true,
  })
  agentShareholders: AgentShareholderDto[] | null;

  @ApiProperty({ type: MerchantBaseFeeConfigDto, isArray: true })
  fees: MerchantBaseFeeConfigDto[];
}

export class MerchantIntervalDto {
  constructor(data: MerchantIntervalDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  userId: number;

  @ApiProperty()
  settlementInterval: number;

  @ApiDateProperty({ required: false, nullable: true })
  @ToJakartaISONullable()
  lastSettlementAt: string | null;
}
