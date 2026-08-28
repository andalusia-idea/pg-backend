import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray } from 'class-validator';
import { IsIpAllowlistEntry } from '../validator';

/** Bounded so a runaway client cannot store an unbounded array on the row. */
const MAX_ALLOWED_IPS = 20;

/**
 * Replaces the caller's IP allowlist wholesale.
 *
 * A replace rather than add/remove: the frontend edits a list and saves it, and
 * a full replace has no partial-failure state to reason about.
 *
 * **An empty array switches the restriction off** - that is the default, and the
 * only way back in for a merchant who has locked themselves out of the merchant
 * API. It must stay permitted.
 */
export class UpdateAllowedIpsDto {
  @ApiProperty({
    type: [String],
    example: ['203.0.113.5', '198.51.100.0/24'],
    description:
      'Bare IPv4/IPv6 addresses or CIDR ranges. Empty array removes the restriction.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_ALLOWED_IPS)
  @IsIpAllowlistEntry({ each: true })
  allowedIps: string[];
}
