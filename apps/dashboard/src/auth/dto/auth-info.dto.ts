import { ApiProperty } from '@nestjs/swagger';
import { DtoHelper } from '../../shared/helper';
import { ROLE } from '../auth.constant';

/** The authenticated principal, carried in the JWT payload and in CLS. */
export class AuthInfoDto {
  constructor(data: AuthInfoDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  userId: number;

  @ApiProperty()
  profileId: number;

  @ApiProperty({ enum: ROLE })
  role: ROLE;
}
