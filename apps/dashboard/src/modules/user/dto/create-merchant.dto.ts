import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { EmailUnique } from '../validator/email-unique.validator';

export class CreateMerchantDto {
  @ApiProperty({ example: 'merchant@manapay.id' })
  @IsString()
  @IsNotEmpty()
  @EmailUnique()
  email: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ownerName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  brandName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  nik: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  ktpImage: string | null;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  npwp: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  province: string;

  /** Kabupaten / Kota */
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  regency: string;

  /** Kecamatan */
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  district: string;

  /** Kelurahan */
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  village: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  postalCode: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  bankCode: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  bankName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  accountHolderName: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  siupFile: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  coordinate: string | null;

  /** Minutes between settlement runs. Defaults to 120 when omitted. */
  @ApiPropertyOptional({ type: Number, nullable: true, example: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  settlementInterval: number | null;
}
