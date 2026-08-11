import { TransactionTypeEnumConfig } from '@dashboard/prisma';
import { ApiProperty } from '@nestjs/swagger';
import {
  ApiMoneyProperty,
  ApiPercentageProperty,
  ToMoneyString,
  ToPercentageString,
} from '../../../shared/decorator';
import { DtoHelper } from '../../../shared/helper';

/** Provider-level fee configuration, before any per-merchant override. */
export class BaseFeeDto {
  constructor(data: BaseFeeDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  id: number;

  /** `PROVIDER_PAYMENTMETHOD_TRANSACTIONTYPE`. */
  @ApiProperty()
  code: string;

  @ApiProperty()
  providerName: string;

  @ApiProperty()
  paymentMethodName: string;

  @ApiProperty({ enum: TransactionTypeEnumConfig })
  transactionType: TransactionTypeEnumConfig;

  @ApiMoneyProperty()
  @ToMoneyString()
  feeProviderFixed: string;

  @ApiPercentageProperty()
  @ToPercentageString()
  feeProviderPercentage: string;
}
