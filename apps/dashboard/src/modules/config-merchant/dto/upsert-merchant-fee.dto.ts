import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional } from 'class-validator';
import {
  ApiMoneyProperty,
  ApiPercentageProperty,
  IsMoney,
  IsPercentage,
} from '../../../shared/decorator';
import { ActionEnum } from '../config-merchant.constant';

export class UpsertMerchantFeeDto {
  @ApiProperty({ enum: ActionEnum, example: ActionEnum.U })
  @IsEnum(ActionEnum)
  action: ActionEnum;

  @ApiProperty()
  @IsInt()
  baseFeeId: number;

  @ApiMoneyProperty()
  @IsMoney()
  feeInternalFixed: string;

  @ApiPercentageProperty()
  @IsPercentage()
  feeInternalPercentage: string;

  /** Defaults to "0" when omitted - a merchant may have no agent fee. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  feeAgentFixed?: string | null;

  /** Defaults to "0" when omitted. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsPercentage()
  feeAgentPercentage?: string | null;
}

export class UpsertMerchantAgentShareholderDto {
  @ApiProperty({ enum: ActionEnum, example: ActionEnum.U })
  @IsEnum(ActionEnum)
  action: ActionEnum;

  @ApiProperty()
  @IsInt()
  agentId: number;

  @ApiPercentageProperty()
  @IsPercentage()
  percentagePerAgent: string;
}
