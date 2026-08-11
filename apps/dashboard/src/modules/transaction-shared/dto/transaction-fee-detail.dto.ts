import { FeeTypeEnum } from '@dashboard/prisma';
import { ApiProperty } from '@nestjs/swagger';
import {
  ApiMoneyProperty,
  ApiPercentageProperty,
  ToMoneyString,
  ToPercentageString,
} from '../../../shared/decorator';
import { DtoHelper } from '../../../shared/helper';

/**
 * One party's cut of a transaction.
 *
 * Legacy declared a separate but byte-identical FeeDetail DTO per transaction
 * type (purchase / topup / withdraw / disbursement); the underlying tables have
 * the same columns, so this is shared.
 */
export class TransactionFeeDetailDto {
  constructor(data: TransactionFeeDetailDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  id: number;

  @ApiProperty({ type: Number, required: false, nullable: true })
  agentId: number | null;

  @ApiProperty({ enum: FeeTypeEnum })
  type: FeeTypeEnum;

  @ApiMoneyProperty()
  @ToMoneyString()
  nominal: string;

  @ApiMoneyProperty()
  @ToMoneyString()
  feeFixed: string;

  @ApiPercentageProperty()
  @ToPercentageString()
  feePercentage: string;
}
