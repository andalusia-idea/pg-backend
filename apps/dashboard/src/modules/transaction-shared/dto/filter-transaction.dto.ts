import { TransactionStatusEnum } from '@dashboard/prisma';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { ApiDateProperty, ToJsDateNullable } from '../../../shared/decorator';

/**
 * Filters shared by every transaction listing.
 *
 * `page` / `size` are read by the @Pagination() decorator, but stay declared so
 * `whitelist: true` doesn't strip them from the query first.
 */
export class FilterTransactionDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  size?: string;

  /** Inclusive; defaults to 7 days ago when omitted. */
  @ApiDateProperty({ required: false, nullable: true })
  @IsOptional()
  @ToJsDateNullable()
  from?: Date | null;

  /** Inclusive; defaults to today when omitted. */
  @ApiDateProperty({ required: false, nullable: true })
  @IsOptional()
  @ToJsDateNullable()
  to?: Date | null;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  merchantId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerName?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paymentMethodName?: string | null;

  @ApiPropertyOptional({ enum: TransactionStatusEnum })
  @IsOptional()
  @IsEnum(TransactionStatusEnum)
  status?: TransactionStatusEnum | null;
}
