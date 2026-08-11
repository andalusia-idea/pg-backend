import { ApiProperty } from '@nestjs/swagger';
import { DtoHelper } from '../../../shared/helper';

/** Flattens `auth.MerchantDetail` and its `auth.User` into one object. */
export class MerchantDto {
  constructor(data: MerchantDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  userId: number;

  /** The MerchantDetail row id, distinct from userId. */
  @ApiProperty()
  profileId: number;

  @ApiProperty()
  email: string;

  @ApiProperty()
  ownerName: string;

  @ApiProperty()
  businessName: string;

  @ApiProperty()
  brandName: string;

  @ApiProperty()
  phoneNumber: string;

  @ApiProperty()
  nik: string;

  @ApiProperty({ type: String, nullable: true })
  ktpImage: string | null;

  @ApiProperty()
  npwp: string;

  @ApiProperty()
  address: string;

  @ApiProperty()
  province: string;

  /** Kabupaten / Kota */
  @ApiProperty()
  regency: string;

  /** Kecamatan */
  @ApiProperty()
  district: string;

  /** Kelurahan */
  @ApiProperty()
  village: string;

  @ApiProperty()
  postalCode: string;

  @ApiProperty()
  bankCode: string;

  @ApiProperty()
  bankName: string;

  @ApiProperty()
  accountNumber: string;

  @ApiProperty()
  accountHolderName: string;

  @ApiProperty({ type: String, nullable: true })
  siupFile: string | null;

  @ApiProperty({ type: String, nullable: true })
  coordinate: string | null;
}

/** Minimal shape for dropdowns. */
export class MerchantNameDto {
  constructor(data: MerchantNameDto) {
    DtoHelper.assign(this, data);
  }

  /** Named `merchantUserId` on the frontend's dropdown type. */
  @ApiProperty()
  userId: number;

  @ApiProperty()
  profileId: number;

  @ApiProperty()
  businessName: string;
}
