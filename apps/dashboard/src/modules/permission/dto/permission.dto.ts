import { ApiProperty } from '@nestjs/swagger';
import { DtoHelper } from '../../../shared/helper';

export class PermissionDto {
  constructor(data: PermissionDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  id: number;

  @ApiProperty({ example: 'read' })
  action: string;

  @ApiProperty({ example: 'MerchantDetail' })
  subject: string;

  /** When true the rule denies rather than grants - CASL's `cannot`. */
  @ApiProperty()
  inverted: boolean;

  @ApiProperty({ type: String, isArray: true })
  field: string[];

  /** CASL condition object, e.g. `{ "merchantId": 12 }`. */
  @ApiProperty({ type: Object, required: false, nullable: true })
  conditions: Record<string, unknown> | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  reason: string | null;

  @ApiProperty({ type: Number, required: false, nullable: true })
  roleId: number | null;
}
