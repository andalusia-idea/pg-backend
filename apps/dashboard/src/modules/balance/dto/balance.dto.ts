import { ApiProperty } from '@nestjs/swagger';
import { ApiMoneyProperty, ToMoneyString } from '../../../shared/decorator';
import { DtoHelper } from '../../../shared/helper';

/** Aggregate across every holder of a given kind. */
export class BalanceDto {
  constructor(data: BalanceDto) {
    DtoHelper.assign(this, data);
  }

  @ApiMoneyProperty()
  @ToMoneyString()
  balanceActive: string;

  @ApiMoneyProperty()
  @ToMoneyString()
  balancePending: string;
}

export class BalanceMerchantDto {
  constructor(data: BalanceMerchantDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  merchantId: number;

  @ApiMoneyProperty()
  @ToMoneyString()
  balanceActive: string;

  @ApiMoneyProperty()
  @ToMoneyString()
  balancePending: string;
}

export class BalanceAgentDto {
  constructor(data: BalanceAgentDto) {
    DtoHelper.assign(this, data);
  }

  @ApiProperty()
  agentId: number;

  @ApiMoneyProperty()
  @ToMoneyString()
  balanceActive: string;

  @ApiMoneyProperty()
  @ToMoneyString()
  balancePending: string;
}
