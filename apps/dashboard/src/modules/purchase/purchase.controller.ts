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
import { FilterTransactionDto } from '../transaction-shared';
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
}
