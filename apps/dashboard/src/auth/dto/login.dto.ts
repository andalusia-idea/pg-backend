import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@manapay.id' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123456789' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
