import { IsNumber, IsOptional } from 'class-validator';

export class CreateMerchantDto {
  @IsNumber()
  id: number;

  @IsNumber()
  agentId: number;

  @IsNumber()
  @IsOptional()
  settlementInterval: number | null;
}
