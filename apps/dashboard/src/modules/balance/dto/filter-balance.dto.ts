import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class FilterAggregateBalanceInternalDto {
  @ApiPropertyOptional({ description: 'Narrow to a single provider' })
  @IsOptional()
  @IsString()
  providerName?: string | null;
}
