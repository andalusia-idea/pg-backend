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

  /**
   * May be a merchant, an agent, or an unrelated third party.
   *
   * `bankCode` is polymorphic: a `config.Bank.code` when `paymentMethodName`
   * is TRANSFERBANK, an `EWalletEnum` value when it's TRANSFEREWALLET.
   * `accountNumber` holds a wallet phone number in that case. The bank's
   * display name isn't stored (it's derivable from `bankCode` via
   * `config.Bank`, not exposed here) — see docs/dashboard-migration.md D23.
   */
  @ApiProperty()
  accountHolderName: string;

  @ApiProperty()
  accountNumber: string;

  @ApiProperty()
  bankCode: string;

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
