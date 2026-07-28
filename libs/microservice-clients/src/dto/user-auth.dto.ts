import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { TransactionUserRole } from '../enums/microservice.enum';

export class FindMerchantsAndAgentsByIdsDto {
  @IsString()
  @IsOptional()
  merchantIds: string | null;

  @IsString()
  @IsOptional()
  agentIds: string | null;
}

export class MerchantSummaryDto {
  id: number;
  name: string;
}

export class AgentSummaryDto {
  id: number;
  name: string;
}

export class MerchantsAndAgentsByIdsResultDto {
  merchants: MerchantSummaryDto[];
  agents: AgentSummaryDto[];
}

export class FindProfileBankDto {
  @IsNumber()
  @Type(() => Number)
  userId: number;
}

export class ProfileBankDto {
  userId: number;
  profileId: number;
  userRole: TransactionUserRole;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
}
