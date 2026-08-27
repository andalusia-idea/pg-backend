import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantEndpoint } from '../merchant-endpoint.decorator';
import { MerchantUserId } from '../merchant-user-id.decorator';

@Controller()
@ApiTags('Merchant API v1')
export class PingController {
  /**
   * Credential and clock check.
   *
   * The one thing merchants genuinely want from a token endpoint - "are my
   * credentials right?" - without any token machinery. Requires a valid
   * signature, touches nothing, and the envelope's `serverTime` lets a
   * merchant compare clocks before attempting a real transaction.
   */
  @Get('/open/v1/ping')
  @MerchantEndpoint()
  @ApiOperation({
    summary: 'Verify credentials and compare clocks (signed, no side effects)',
  })
  ping(@MerchantUserId() merchantUserId: number) {
    return { merchantUserId };
  }
}
