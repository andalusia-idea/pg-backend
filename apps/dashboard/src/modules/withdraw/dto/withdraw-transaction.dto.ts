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

/**
 * Withdrawals are keyed by `userId` + `userRole` rather than `merchantId`,
 * because an agent can withdraw as well as a merchant.
 */
export class WithdrawTransactionDto {
  constructor(data: WithdrawTransactionDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  id: number;

  /** Our transaction identifier (`transactionId` in the SNAP merchant API). */
  @ApiProperty()
  systemReference: string;

  /** Provider supplied `referenceNo` in the SNAP API; absent until assigned upstream. */
  @ApiProperty({ type: String, required: false, nullable: true })
  providerReference: string | null;

  /** Reference assigned by the bank, when available. */
  @ApiProperty({ type: String, required: false, nullable: true })
  bankReference: string | null;

  @ApiProperty()
  userId: number;

  @ApiProperty()
  userRole: string;

  @ApiProperty()
  providerName: string;

  @ApiProperty()
  paymentMethodName: string;

  /**
   * Null when `paymentMethodName` is USDT, which has no bank, no account
   * number and no account holder. `bankCode` is polymorphic for the BANK
   * case: a `config.Bank.code`, not a display name — see
   * docs/dashboard-migration.md D23.
   */
  @ApiProperty({ type: String, required: false, nullable: true })
  accountHolderName: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  accountNumber: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  bankCode: string | null;

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
  additionalInfo: Record<string, unknown> | null;

  @ApiProperty({ type: Object, required: false, nullable: true })
  metadata: Record<string, unknown> | null;

  @ApiDateProperty({ required: false, nullable: true })
  @ToJakartaISONullable()
  paidAt: string | null;

  @ApiDateProperty()
  @ToJakartaISO()
  createdAt: string;

  @ApiProperty({ type: TransactionFeeDetailDto, isArray: true })
  feeDetails: TransactionFeeDetailDto[];
}
