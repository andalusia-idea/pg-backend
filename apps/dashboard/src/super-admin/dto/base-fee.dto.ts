import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum } from 'class-validator';
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionTypeEnum,
} from '@app/microservice';
import {
  ApiMoneyProperty,
  ApiPercentageProperty,
  IsMoney,
  IsPercentage,
} from '../../shared';

export class UpsertBaseFeeDto {
  @ApiProperty({ enum: ProviderNameEnum })
  @IsEnum(ProviderNameEnum)
  providerName: ProviderNameEnum;

  @ApiProperty({ enum: PaymentMethodNameEnum })
  @IsEnum(PaymentMethodNameEnum)
  paymentMethodName: PaymentMethodNameEnum;

  @ApiProperty({ enum: TransactionTypeEnum })
  @IsEnum(TransactionTypeEnum)
  transactionType: TransactionTypeEnum;

  /**
   * `@IsBoolean()` is load-bearing, not decoration. ParseDtoArrayPipe validates
   * with `whitelist: true`, which strips every property carrying no
   * class-validator decorator - `@ApiProperty` is a Swagger decorator and does
   * not count. Without this the field was removed from the payload before the
   * service saw it, so a create fell back to the column default `true` and an
   * update skipped the field entirely: a base fee could never be deactivated,
   * and the request still answered 201.
   */
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  isActive: boolean;

  @ApiMoneyProperty()
  @IsMoney()
  feeProviderFixed: string;

  @ApiPercentageProperty()
  @IsPercentage()
  feeProviderPercentage: string;
}
