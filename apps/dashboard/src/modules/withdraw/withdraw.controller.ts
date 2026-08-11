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
import { WithdrawTransactionDto } from './dto/withdraw-transaction.dto';
import { WithdrawService } from './withdraw.service';

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller('transactions/withdraw')
export class WithdrawController {
  constructor(private readonly withdrawService: WithdrawService) {}

  @Get()
  @CheckPolicies()
  @ApiOperation({ summary: 'Withdrawals (defaults to last 7 days)' })
  @ApiOkResponse({ type: WithdrawTransactionDto, isArray: true })
  findAll(
    @Pagination() pageable: Pageable,
    @Query() filter: FilterTransactionDto,
  ): Promise<Page<WithdrawTransactionDto>> {
    return this.withdrawService.findAll(pageable, filter);
  }

  // POST / is not ported yet - it depends on the fee-calculation and
  // balance-ledger subsystems. See docs/dashboard-migration.md.
}
