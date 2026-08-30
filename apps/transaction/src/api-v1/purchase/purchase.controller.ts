import { Controller, Logger, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantEndpoint, MerchantUserId } from '../signature';

@Controller()
@ApiTags('Merchant API v1')
export class PurchaseController {
  private readonly logger = new Logger(PurchaseController.name);

  @Post('/open/v1/test')
  @MerchantEndpoint()
  @ApiOperation({ summary: 'Purchase Test' })
  test(@MerchantUserId() merchantUserId: number) {
    return { merchantUserId };
  }
}
