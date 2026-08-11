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
import { TopupTransactionDto } from './dto/topup-transaction.dto';
import { TopupService } from './topup.service';

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller('transactions/topup')
export class TopupController {
  constructor(private readonly topupService: TopupService) {}

  @Get()
  @CheckPolicies()
  @ApiOperation({ summary: 'Top-up transactions (defaults to last 7 days)' })
  @ApiOkResponse({ type: TopupTransactionDto, isArray: true })
  findAll(
    @Pagination() pageable: Pageable,
    @Query() filter: FilterTransactionDto,
  ): Promise<Page<TopupTransactionDto>> {
    return this.topupService.findAll(pageable, filter);
  }

  // POST / , POST /approve and POST /reject are not ported yet - they depend on
  // the fee-calculation and balance-ledger subsystems. See docs/dashboard-migration.md.
}
