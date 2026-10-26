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

export class PurchaseTransactionDto {
  constructor(data: PurchaseTransactionDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  id: number;

  /** Our transaction identifier (`transactionId` in the SNAP merchant API). */
  @ApiProperty()
  systemReference: string;

  /** Merchant supplied `partnerReferenceNo` in the SNAP API. */
  @ApiProperty()
  merchantReference: string;

  /** Provider supplied `referenceNo` in the SNAP API; absent until assigned upstream. */
  @ApiProperty({ type: String, required: false, nullable: true })
  providerReference: string | null;

  /** Reference assigned by the bank, when available. */
  @ApiProperty({ type: String, required: false, nullable: true })
  bankReference: string | null;

  @ApiProperty()
  merchantId: number;

  @ApiProperty()
  providerName: string;

  @ApiProperty()
  paymentMethodName: string;

  @ApiMoneyProperty()
  @ToMoneyString()
  nominal: string;

  /** Nominal after fees. */
  @ApiMoneyProperty()
  @ToMoneyString()
  netNominal: string;

  /** Sum of feeDetails - derived, not a column. */
  @ApiMoneyProperty()
  totalFeeCut: string;

  @ApiProperty({ enum: TransactionStatusEnum })
  status: TransactionStatusEnum;

  @ApiProperty({ type: Object, required: false, nullable: true })
  additionalInfo: Record<string, unknown> | null;

  @ApiProperty({ type: Object, required: false, nullable: true })
  metadata: Record<string, unknown> | null;

  @ApiDateProperty({ required: false, nullable: true })
  @ToJakartaISONullable()
  settlementAt: string | null;

  @ApiDateProperty({ required: false, nullable: true })
  @ToJakartaISONullable()
  paidAt: string | null;

  @ApiDateProperty()
  @ToJakartaISO()
  createdAt: string;

  @ApiProperty({ type: TransactionFeeDetailDto, isArray: true })
  feeDetails: TransactionFeeDetailDto[];
}
