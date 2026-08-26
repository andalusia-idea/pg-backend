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
import { DisbursementCallbackActionDto } from './dto/disbursement-callback-action.dto';
import { DisbursementService } from './disbursement.service';
import { DisbursementTransactionDto } from './dto/disbursement-transaction.dto';

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller('transactions/disbursement')
export class DisbursementController {
  constructor(private readonly disbursementService: DisbursementService) {}

  @Get()
  @CheckPolicies()
  @ApiOperation({
    summary: 'Disbursement transactions (defaults to last 7 days)',
  })
  @ApiOkResponse({ type: DisbursementTransactionDto, isArray: true })
  findAll(
    @Pagination() pageable: Pageable,
    @Query() filter: FilterTransactionDto,
  ): Promise<Page<DisbursementTransactionDto>> {
    return this.disbursementService.findAll(pageable, filter);
  }

  /**
   * STUB - see docs/dashboard-migration.md §2.3, row 45. Wired for the
   * frontend to integrate against; the provider-callback logic is not yet
   * implemented.
   */
  @Post('resend-callback')
  @CheckPolicies()
  @ApiOperation({
    summary: "Resend this disbursement's provider callback (stub)",
  })
  @ApiBody({ type: DisbursementCallbackActionDto })
  async resendCallback(
    @Body() dto: DisbursementCallbackActionDto,
  ): Promise<ResponseDto<null>> {
    await this.disbursementService.resendCallback(dto);
    return new ResponseDto({ status: ResponseStatus.SUCCESS });
  }

  /** STUB - see docs/dashboard-migration.md §2.3, row 46. */
  @Post('refresh-status')
  @CheckPolicies()
  @ApiOperation({
    summary: "Re-poll the provider for this disbursement's status (stub)",
  })
  @ApiBody({ type: DisbursementCallbackActionDto })
  async refreshStatus(
    @Body() dto: DisbursementCallbackActionDto,
  ): Promise<ResponseDto<null>> {
    await this.disbursementService.refreshStatus(dto);
    return new ResponseDto({ status: ResponseStatus.SUCCESS });
  }

  /** STUB - see docs/dashboard-migration.md §2.3, row 47. */
  @Post('notify-merchant')
  @CheckPolicies()
  @ApiOperation({
    summary: "Re-send this disbursement's webhook to the merchant (stub)",
  })
  @ApiBody({ type: DisbursementCallbackActionDto })
  async notifyMerchant(
    @Body() dto: DisbursementCallbackActionDto,
  ): Promise<ResponseDto<null>> {
    await this.disbursementService.notifyMerchant(dto);
    return new ResponseDto({ status: ResponseStatus.SUCCESS });
  }
}
