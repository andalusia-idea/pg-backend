import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { EmailUnique } from '../../modules/user/validator/email-unique.validator';

export class CreateAdminDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @EmailUnique()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(16)
  password: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fullname: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  phone: string;
}
