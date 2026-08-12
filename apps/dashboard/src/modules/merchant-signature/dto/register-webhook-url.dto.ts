import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class RegisterWebhookUrlDto {
  @ApiProperty({ example: 'https://merchant.example.com/webhook/payin' })
  @IsUrl()
  payinUrl: string;

  @ApiProperty({ example: 'https://merchant.example.com/webhook/payout' })
  @IsUrl()
  payoutUrl: string;
}
