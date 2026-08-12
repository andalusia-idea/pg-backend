import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { ApiDateProperty, ToJsDateNullable } from '../../../shared/decorator';

export class FilterSettlementDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  size?: string;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  merchantId?: number | null;

  /** Only applied when both from and to are supplied, matching legacy. */
  @ApiDateProperty({ required: false, nullable: true })
  @IsOptional()
  @ToJsDateNullable()
  from?: Date | null;

  @ApiDateProperty({ required: false, nullable: true })
  @IsOptional()
  @ToJsDateNullable()
  to?: Date | null;
}
