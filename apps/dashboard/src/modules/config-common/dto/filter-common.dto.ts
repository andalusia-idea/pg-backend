import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { CommonDiv } from '../config-common.constant';

export class FilterCommonDto {
  @ApiProperty({ enum: CommonDiv, example: CommonDiv.PAYMENT_METHOD })
  @IsEnum(CommonDiv)
  div: CommonDiv;
}
