import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../auth/decorator';
import { BalanceService } from './balance.service';
import {
  BalanceAgentDto,
  BalanceDto,
  BalanceMerchantDto,
} from './dto/balance.dto';
import { FilterAggregateBalanceInternalDto } from './dto/filter-balance.dto';

/**
 * Legacy declared this `@Controller('Balance')` with a capital B and relied on
 * Express's case-insensitive routing to match the frontend's lowercase calls.
 * Lowercase here so the route and the caller agree literally.
 */
@ApiTags('Balance')
@ApiBearerAuth()
@Controller('balance')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  // Static segments must precede `:id` routes so Express does not treat
  // "aggregate" as an id.
  @Get('aggregate/internal')
  @CheckPolicies()
  @ApiOperation({ summary: 'Internal (house) balance' })
  @ApiOkResponse({ type: BalanceDto })
  aggregateInternal(
    @Query() filter: FilterAggregateBalanceInternalDto,
  ): Promise<BalanceDto> {
    return this.balanceService.aggregateBalanceInternal(filter.providerName);
  }

  @Get('aggregate/merchant')
  @CheckPolicies()
  @ApiOperation({ summary: 'Total balance across all merchants' })
  @ApiOkResponse({ type: BalanceDto })
  aggregateMerchant(): Promise<BalanceDto> {
    return this.balanceService.aggregateBalanceMerchant();
  }

  @Get('aggregate/agent')
  @CheckPolicies()
  @ApiOperation({ summary: 'Total balance across all agents' })
  @ApiOkResponse({ type: BalanceDto })
  aggregateAgent(): Promise<BalanceDto> {
    return this.balanceService.aggregateBalanceAgent();
  }

  @Get('merchant/:merchantId')
  @CheckPolicies()
  @ApiOperation({ summary: 'Balance for one merchant' })
  @ApiOkResponse({ type: BalanceMerchantDto })
  merchantBalance(
    @Param('merchantId', ParseIntPipe) merchantId: number,
  ): Promise<BalanceMerchantDto> {
    return this.balanceService.checkBalanceMerchant(merchantId);
  }

  @Get('agent/:agentId')
  @CheckPolicies()
  @ApiOperation({ summary: 'Balance for one agent' })
  @ApiOkResponse({ type: BalanceAgentDto })
  agentBalance(
    @Param('agentId', ParseIntPipe) agentId: number,
  ): Promise<BalanceAgentDto> {
    return this.balanceService.checkBalanceAgent(agentId);
  }
}
