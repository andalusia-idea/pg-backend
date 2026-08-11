import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../auth/decorator';
import { Page, Pagination } from '../../shared/pagination';
import type { Pageable } from '../../shared/pagination';
import { PurchaseTransactionDto } from '../purchase/dto/purchase-transaction.dto';
import { FilterSettlementDto } from './dto/filter-settlement.dto';
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
}
