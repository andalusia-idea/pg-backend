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
}
