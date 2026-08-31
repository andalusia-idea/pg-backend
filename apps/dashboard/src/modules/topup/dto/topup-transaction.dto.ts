import { TransactionStatusEnum } from '@dashboard/prisma';
import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateProperty,
  ApiMoneyProperty,
  ToJakartaISO,
  ToJakartaISONullable,
  ToMoneyString,
} from '../../../shared/decorator';
import { DtoHelper } from '../../../shared/helper';
import { TransactionFeeDetailDto } from '../../transaction-shared';

export class TopupTransactionDto {
  constructor(data: TopupTransactionDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  id: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  externalId: string | null;

  @ApiProperty()
  referenceId: string;

  @ApiProperty()
  merchantId: number;

  @ApiProperty()
  providerName: string;

  @ApiProperty()
  paymentMethodName: string;

  /** Proof-of-transfer image supplied at request time. */
  @ApiProperty()
  receiptImage: string;

  @ApiMoneyProperty()
  @ToMoneyString()
  nominal: string;

  @ApiMoneyProperty()
  @ToMoneyString()
  netNominal: string;

  @ApiMoneyProperty()
  totalFeeCut: string;

  @ApiProperty({ enum: TransactionStatusEnum })
  status: TransactionStatusEnum;

  @ApiDateProperty({ required: false, nullable: true })
  @ToJakartaISONullable()
  settlementAt: string | null;

  @ApiDateProperty({ required: false, nullable: true })
  @ToJakartaISONullable()
  reconciliationAt: string | null;

  @ApiDateProperty({ required: false, nullable: true })
  @ToJakartaISONullable()
  paidAt: string | null;

  @ApiDateProperty()
  @ToJakartaISO()
  createdAt: string;

  @ApiProperty({ type: TransactionFeeDetailDto, isArray: true })
  feeDetails: TransactionFeeDetailDto[];
}
