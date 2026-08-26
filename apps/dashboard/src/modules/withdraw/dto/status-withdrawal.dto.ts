import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Request body for `POST transactions/withdraw/{approve,reject}`.
 *
 * STUB DTO - matches what the frontend already sends (`StatusWithdrawal` in
 * `transaction-withdrawal.type.ts`) so the shape is locked in; the handlers
 * behind it are placeholders pending the D17 balance-ledger decision. See
 * docs/dashboard-migration.md §2.3, rows 40-41.
 */
export class StatusWithdrawalDto {
  @ApiProperty({ example: '42' })
  @IsString()
  @IsNotEmpty()
  withdrawalId: string;
}
