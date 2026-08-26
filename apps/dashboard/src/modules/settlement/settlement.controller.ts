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
import { PurchaseTransactionDto } from '../purchase/dto/purchase-transaction.dto';
import { FilterSettlementDto } from './dto/filter-settlement.dto';
import { SettleUnsettledDto } from './dto/settle-unsettled.dto';
import { SettlementService } from './settlement.service';

@ApiTags('Settlement')
@ApiBearerAuth()
@Controller('settlement')
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Get('settled')
  @CheckPolicies()
  @ApiOperation({ summary: 'Settled purchases' })
  @ApiOkResponse({ type: PurchaseTransactionDto, isArray: true })
  findAllSettled(
    @Pagination() pageable: Pageable,
    @Query() filter: FilterSettlementDto,
  ): Promise<Page<PurchaseTransactionDto>> {
    return this.settlementService.findAllSettled(pageable, filter);
  }

  @Get('unsettled')
  @CheckPolicies()
  @ApiOperation({ summary: 'Successful purchases awaiting settlement' })
  @ApiOkResponse({ type: PurchaseTransactionDto, isArray: true })
  findAllUnsettled(
    @Pagination() pageable: Pageable,
    @Query() filter: FilterSettlementDto,
  ): Promise<Page<PurchaseTransactionDto>> {
    return this.settlementService.findAllUnsettled(pageable, filter);
  }

  /**
   * STUB - see docs/dashboard-migration.md §2.4, row 48. Wired for the
   * frontend to integrate against; the real settlement write is not yet
   * implemented.
   */
  @Post('settle')
  @CheckPolicies()
  @ApiOperation({ summary: 'Mark unsettled purchases as settled (stub)' })
  @ApiBody({ type: SettleUnsettledDto })
  async settle(@Body() dto: SettleUnsettledDto): Promise<ResponseDto<null>> {
    await this.settlementService.settle(dto);
    return new ResponseDto({ status: ResponseStatus.UPDATED });
  }
}
