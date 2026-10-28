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
    // Derived, not stored. `BaseFee.code` used to be a column holding this
    // exact string; it was dropped because nothing checked it against the three
    // fields it was built from, so a typo could split a triple that is supposed
    // to be unique. Rebuilding it here keeps the response shape the frontend
    // already consumes, with no second copy that can drift.
    this.code = `${this.providerName}_${this.paymentMethodName}_${this.transactionType}`;
  }

  @ApiProperty()
  id: number;

  /** `PROVIDER_PAYMENTMETHOD_TRANSACTIONTYPE`, derived in the constructor. */
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
