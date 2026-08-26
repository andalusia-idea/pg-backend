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
import { StatusWithdrawalDto } from './dto/status-withdrawal.dto';
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

  /**
   * STUB - see docs/dashboard-migration.md §2.3, row 40. Wired for the
   * frontend to integrate against; the balance-ledger write is pending D17.
   */
  @Post('approve')
  @CheckPolicies()
  @ApiOperation({ summary: 'Approve a pending withdrawal (stub, see D17)' })
  @ApiBody({ type: StatusWithdrawalDto })
  async approve(@Body() dto: StatusWithdrawalDto): Promise<ResponseDto<null>> {
    await this.withdrawService.approve(dto);
    return new ResponseDto({ status: ResponseStatus.UPDATED });
  }

  /**
   * STUB - see docs/dashboard-migration.md §2.3, row 41. Same status as
   * `approve` above.
   */
  @Post('reject')
  @CheckPolicies()
  @ApiOperation({ summary: 'Reject a pending withdrawal (stub, see D17)' })
  @ApiBody({ type: StatusWithdrawalDto })
  async reject(@Body() dto: StatusWithdrawalDto): Promise<ResponseDto<null>> {
    await this.withdrawService.reject(dto);
    return new ResponseDto({ status: ResponseStatus.UPDATED });
  }
}
