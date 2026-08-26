import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../auth/decorator';
import { Page, Pagination } from '../../shared/pagination';
import type { Pageable } from '../../shared/pagination';
import { ResponseDto, ResponseStatus } from '../../shared/response.dto';
import { FilterTransactionDto } from '../transaction-shared';
import { PurchaseCallbackActionDto } from './dto/purchase-callback-action.dto';
import { PurchaseTransactionDto } from './dto/purchase-transaction.dto';
import { PurchaseService } from './purchase.service';

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller('transactions/purchase')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Get()
  @CheckPolicies()
  @ApiOperation({ summary: 'Purchase transactions (defaults to last 7 days)' })
  @ApiOkResponse({ type: PurchaseTransactionDto, isArray: true })
  findAll(
    @Pagination() pageable: Pageable,
    @Query() filter: FilterTransactionDto,
  ): Promise<Page<PurchaseTransactionDto>> {
    return this.purchaseService.findAll(pageable, filter);
  }

  /**
   * STUB - see docs/dashboard-migration.md §2.3, row 42. Wired for the
   * frontend to integrate against; the provider-callback logic is not yet
   * implemented.
   */
  @Post('resend-callback')
  @CheckPolicies()
  @ApiOperation({
    summary: "Resend this purchase's provider callback (stub)",
  })
  @ApiBody({ type: PurchaseCallbackActionDto })
  async resendCallback(
    @Body() dto: PurchaseCallbackActionDto,
  ): Promise<ResponseDto<null>> {
    await this.purchaseService.resendCallback(dto);
    return new ResponseDto({ status: ResponseStatus.SUCCESS });
  }

  /** STUB - see docs/dashboard-migration.md §2.3, row 43. */
  @Post('refresh-status')
  @CheckPolicies()
  @ApiOperation({
    summary: "Re-poll the provider for this purchase's status (stub)",
  })
  @ApiBody({ type: PurchaseCallbackActionDto })
  async refreshStatus(
    @Body() dto: PurchaseCallbackActionDto,
  ): Promise<ResponseDto<null>> {
    await this.purchaseService.refreshStatus(dto);
    return new ResponseDto({ status: ResponseStatus.SUCCESS });
  }

  /** STUB - see docs/dashboard-migration.md §2.3, row 44. */
  @Post('notify-merchant')
  @CheckPolicies()
  @ApiOperation({
    summary: "Re-send this purchase's webhook to the merchant (stub)",
  })
  @ApiBody({ type: PurchaseCallbackActionDto })
  async notifyMerchant(
    @Body() dto: PurchaseCallbackActionDto,
  ): Promise<ResponseDto<null>> {
    await this.purchaseService.notifyMerchant(dto);
    return new ResponseDto({ status: ResponseStatus.SUCCESS });
  }
}
