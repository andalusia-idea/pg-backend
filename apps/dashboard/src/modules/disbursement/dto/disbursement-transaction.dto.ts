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

export class DisbursementTransactionDto {
  constructor(data: DisbursementTransactionDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  id: number;

  @ApiProperty({ type: String, required: false, nullable: true })
  externalId: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  referenceId: string | null;

  @ApiProperty()
  merchantId: number;

  @ApiProperty()
  providerName: string;

  @ApiProperty()
  paymentMethodName: string;

  /** May be a merchant, an agent, or an unrelated third party. */
  @ApiProperty()
  recipientName: string;

  @ApiProperty()
  recipientBankCode: string;

  @ApiProperty({ type: String, required: false, nullable: true })
  recipientBankName: string | null;

  @ApiProperty()
  recipientAccount: string;

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

  @ApiProperty({ type: Object, required: false, nullable: true })
  metadata: Record<string, unknown> | null;

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
