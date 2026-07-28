import { Type } from 'class-transformer';
import { IsEnum, IsNumber } from 'class-validator';
import {
  TransactionTypeEnum,
  TransactionUserRole,
} from '../enums/microservice.enum';

export class FindProfileProviderDto {
  @IsNumber()
  @Type(() => Number)
  userId: number;

  @IsEnum(TransactionUserRole)
  userRole: TransactionUserRole;

  @IsEnum(TransactionTypeEnum)
  transactionType: TransactionTypeEnum;
}

export class ProfileProviderResultDto {
  userId: number;
  userRole: TransactionUserRole;
  providerName: string;
  paymentMethodName: string;
}
