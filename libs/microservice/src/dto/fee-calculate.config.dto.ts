import { Type, Static } from '@sinclair/typebox';
import {
  MoneyType,
  PaymentMethodNameEnum,
  PercentageType,
  ProviderNameEnum,
} from '../microservice.enum';

/// REQUEST
const BaseFeeFilterSchema = Type.Object({
  merchantId: Type.Number(),
  providerName: Type.Enum(ProviderNameEnum),
  paymentMethodName: Type.Enum(PaymentMethodNameEnum),
  nominal: MoneyType,
});

export const FilterPurchaseFeeSchema = Type.Composite([BaseFeeFilterSchema], {
  additionalProperties: false,
});
export type FilterPurchaseFeeDto = Static<typeof FilterPurchaseFeeSchema>;

export const FilterDisbursementFeeSchema = Type.Composite(
  [BaseFeeFilterSchema],
  {
    additionalProperties: false,
  },
);
export type FilterDisbursementFeeDto = Static<
  typeof FilterDisbursementFeeSchema
>;

/// RESPONSE
const BaseFeeSchema = Type.Object({
  nominal: MoneyType,
  feeFixed: MoneyType,
  feePercentage: PercentageType,
});

export const ProviderFeeSchema = Type.Composite(
  [
    BaseFeeSchema,
    Type.Object({
      name: Type.String(),
    }),
  ],
  {
    additionalProperties: false,
  },
);
export type ProviderFeeDto = Static<typeof ProviderFeeSchema>;

export const InternalFeeSchema = Type.Composite([BaseFeeSchema], {
  additionalProperties: false,
});
export type InternalFeeDto = Static<typeof InternalFeeSchema>;

export const AgentFeeEachSchema = Type.Object(
  {
    agentId: Type.Number(),
    nominal: MoneyType,
    feePercentage: PercentageType,
  },
  {
    additionalProperties: false,
  },
);
export type AgentFeeEachDto = Static<typeof AgentFeeEachSchema>;

export const AgentFeeSchema = Type.Composite(
  [
    BaseFeeSchema,
    Type.Object({
      agents: Type.Array(AgentFeeEachSchema),
    }),
  ],
  {
    additionalProperties: false,
  },
);
export type AgentFeeDto = Static<typeof AgentFeeSchema>;

export const MerchantFeeSchema = Type.Object(
  {
    merchantId: Type.Number(),
    nominal: MoneyType,
    netNominal: MoneyType,
    feePercentage: PercentageType,
  },
  { additionalProperties: false },
);
export type MerchantFeeDto = Static<typeof MerchantFeeSchema>;

/////////////////////
export const FeeCalculationResultSchema = Type.Object(
  {
    merchantFee: MerchantFeeSchema,
    agentFee: AgentFeeSchema,
    providerFee: ProviderFeeSchema,
    internalFee: InternalFeeSchema,
  },
  { additionalProperties: false },
);
export type FeeCalculationResultDto = Static<typeof FeeCalculationResultSchema>;
