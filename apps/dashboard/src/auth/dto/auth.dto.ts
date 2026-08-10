import { ApiProperty } from '@nestjs/swagger';
import { DtoHelper } from '../../shared/helper';
import { AuthInfoDto } from './auth-info.dto';

export class AuthDto {
  constructor(data: AuthDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  token: string;

  @ApiProperty({ type: AuthInfoDto })
  authInfo: AuthInfoDto;
}
