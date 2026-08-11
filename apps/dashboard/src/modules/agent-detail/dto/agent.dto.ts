import { ApiProperty } from '@nestjs/swagger';
import { DtoHelper } from '../../../shared/helper';

/** Flattens `auth.AgentDetail` and its `auth.User` into the shape the frontend expects. */
export class AgentDto {
  constructor(data: AgentDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  userId: number;

  /** The AgentDetail row id, distinct from userId. */
  @ApiProperty()
  profileId: number;

  @ApiProperty()
  email: string;

  @ApiProperty()
  fullname: string;

  @ApiProperty()
  address: string;

  @ApiProperty()
  phone: string;

  @ApiProperty()
  bankCode: string;

  @ApiProperty()
  bankName: string;

  @ApiProperty()
  accountNumber: string;

  @ApiProperty()
  accountHolderName: string;
}

/** Minimal shape for dropdowns. */
export class AgentNameDto {
  constructor(data: AgentNameDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  userId: number;

  @ApiProperty()
  profileId: number;

  @ApiProperty()
  fullname: string;
}
