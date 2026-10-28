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

  /**
   * Current IP allowlist. Empty means unrestricted, which is the default.
   *
   * Returned here rather than from a separate GET so the settings page can
   * prefill the webhook form and the IP form from one call.
   */
  @ApiProperty({ type: [String], example: ['203.0.113.5'] })
  allowedIps: string[];
}
