import { ApiProperty } from '@nestjs/swagger';
import {
  ApiDateProperty,
  ToJakartaISONullable,
} from '../../../shared/decorator';
import { DtoHelper } from '../../../shared/helper';

/**
 * Backs the merchant detail page's "Has Generated Key On" display and
 * pre-fills the webhook form on reopen. See docs/dashboard-migration.md
 * §2.1, row 39 - newly added endpoint, no legacy equivalent to port from.
 */
export class MerchantSignatureStatusDto {
  constructor(data: MerchantSignatureStatusDto) {
    DtoHelper.assign(this, data);
  }

  @ApiDateProperty({ required: false, nullable: true })
  @ToJakartaISONullable()
  secretKeyGeneratedAt: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  payinUrl: string | null;

  @ApiProperty({ type: String, required: false, nullable: true })
  payoutUrl: string | null;
}
