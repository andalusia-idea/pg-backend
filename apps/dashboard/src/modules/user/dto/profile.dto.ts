import { ApiProperty } from '@nestjs/swagger';
import { DtoHelper } from '../../../shared/helper';

export class ProfileAdminDetailDto {
  constructor(data: ProfileAdminDetailDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  fullname: string;

  @ApiProperty()
  address: string;

  @ApiProperty()
  phone: string;
}

export class ProfileAgentDetailDto {
  constructor(data: ProfileAgentDetailDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  fullname: string;

  @ApiProperty()
  address: string;

  @ApiProperty()
  phone: string;

  @ApiProperty()
  bankName: string;

  @ApiProperty()
  accountNumber: string;

  @ApiProperty()
  accountHolderName: string;
}

export class ProfileMerchantDetailDto {
  constructor(data: ProfileMerchantDetailDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  businessName: string;

  @ApiProperty()
  npwp: string;

  @ApiProperty()
  address: string;

  @ApiProperty()
  bankName: string;

  @ApiProperty()
  accountNumber: string;

  @ApiProperty()
  accountHolderName: string;
}

/**
 * Exactly one of admin / agent / merchant is populated, matching the caller's
 * role; the other two stay null. Shape mirrors the frontend's ProfileDto.
 */
export class ProfileDto {
  constructor(data: Partial<ProfileDto> & { userId: number; email: string }) {
    this.admin = null;
    this.agent = null;
    this.merchant = null;
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  userId: number;

  @ApiProperty()
  profileId: number;

  @ApiProperty()
  email: string;

  @ApiProperty({ type: ProfileAdminDetailDto, required: false, nullable: true })
  admin: ProfileAdminDetailDto | null;

  @ApiProperty({ type: ProfileAgentDetailDto, required: false, nullable: true })
  agent: ProfileAgentDetailDto | null;

  @ApiProperty({
    type: ProfileMerchantDetailDto,
    required: false,
    nullable: true,
  })
  merchant: ProfileMerchantDetailDto | null;
}
