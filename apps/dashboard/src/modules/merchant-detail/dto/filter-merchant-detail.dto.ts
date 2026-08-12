import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * `page` / `size` are read by the @Pagination() decorator, not from here, but
 * they stay declared so `whitelist: true` doesn't strip them before it looks.
 */
export class FilterMerchantDetailDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  size?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive partial match' })
  @IsOptional()
  @IsString()
  businessName?: string | null;
}
