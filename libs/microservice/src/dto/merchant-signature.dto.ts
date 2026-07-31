import { Type, Static } from '@sinclair/typebox';

export const FilterMerchantWebhookUrlSchema = Type.Object(
  {
    userId: Type.Number(),
  },
  { additionalProperties: false },
);
export type FilterMerchantWebhookUrlDto = Static<
  typeof FilterMerchantWebhookUrlSchema
>;

export const MerchantWebhookUrlSchema = Type.Object(
  {
    payinUrl: Type.Union([Type.String(), Type.Null()]),
    payoutUrl: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);
export type MerchantWebhookUrlDto = Static<typeof MerchantWebhookUrlSchema>;
