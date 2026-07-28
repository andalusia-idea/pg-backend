import Decimal from 'decimal.js';
import { ToDecimalFixed } from './decimal.transform';

export class AgentFeeEachDto {
  id: number;

  @ToDecimalFixed()
  nominal: Decimal;

  @ToDecimalFixed()
  feePercentage: Decimal;
}

export class AgentFeeDto {
  @ToDecimalFixed()
  nominal: Decimal;

  @ToDecimalFixed()
  feeFixed: Decimal;

  @ToDecimalFixed()
  feePercentage: Decimal;

  agents: AgentFeeEachDto[];
}

export class MerchantFeeDto {
  id: number;

  @ToDecimalFixed()
  nominal: Decimal;

  @ToDecimalFixed()
  netNominal: Decimal;

  @ToDecimalFixed()
  feePercentage: Decimal;
}

export class ProviderFeeDto {
  name: string;

  @ToDecimalFixed()
  nominal: Decimal;

  @ToDecimalFixed()
  feeFixed: Decimal;

  @ToDecimalFixed()
  feePercentage: Decimal;
}

export class InternalFeeDto {
  @ToDecimalFixed()
  nominal: Decimal;

  @ToDecimalFixed()
  feeFixed: Decimal;

  @ToDecimalFixed()
  feePercentage: Decimal;
}

/**
 * Identical response shape for purchase/withdraw/topup/disbursement fee
 * calculation - only the request filter and the cmd differ between them.
 */
export class FeeCalculationResultDto {
  merchantFee: MerchantFeeDto;
  agentFee: AgentFeeDto;
  providerFee: ProviderFeeDto;
  internalFee: InternalFeeDto;
}
