import { Type } from 'class-transformer';
import { IsNumber, IsString, ValidateIf } from 'class-validator';
import Decimal from 'decimal.js';
import { ToDecimal } from './decimal.transform';

abstract class BaseFeeFilterDto {
  @IsString()
  providerName: string;

  @IsString()
  paymentMethodName: string;

  @ToDecimal()
  @Type(() => Decimal)
  @ValidateIf((o: BaseFeeFilterDto) => o.nominal !== undefined)
  nominal: Decimal;
}

export class PurchaseFeeFilterDto extends BaseFeeFilterDto {
  @IsNumber()
  @Type(() => Number)
  merchantId: number;
}

export class TopupFeeFilterDto extends BaseFeeFilterDto {
  @IsNumber()
  @Type(() => Number)
  merchantId: number;
}

export class DisbursementFeeFilterDto extends BaseFeeFilterDto {
  @IsNumber()
  @Type(() => Number)
  merchantId: number;
}

/**
 * Withdraw is keyed by userId, not merchantId - a withdraw can be initiated
 * by an agent as well as a merchant. Preserved from the original service
 * rather than forced into the merchantId shape the other three share.
 */
export class WithdrawFeeFilterDto extends BaseFeeFilterDto {
  @IsNumber()
  @Type(() => Number)
  userId: number;
}
