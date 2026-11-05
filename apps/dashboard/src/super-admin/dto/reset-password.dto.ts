import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  /**
   * 16 to match MIN_LENGTH_PRODUCTION in PrincipalConfig. This endpoint sets
   * the *permanent* password for the most privileged accounts in the system, so
   * it should not be weaker than the bootstrap value it replaces.
   */
  @ApiProperty()
  @IsString()
  @MinLength(16)
  password: string;
}
