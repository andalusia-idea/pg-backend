import { Type, Static } from '@sinclair/typebox';
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionTypeEnum,
  UserRoleEnum,
} from '../microservice.enum';

/// REQUEST
export const FilterProfileProviderSchema = Type.Object(
  {
    userId: Type.Number(),
    userRole: Type.Enum(UserRoleEnum),
    transactionType: Type.Enum(TransactionTypeEnum),
  },
  { additionalProperties: false },
);
export type FilterProfileProviderDto = Static<
  typeof FilterProfileProviderSchema
>;

/// RESPONSE
export const ProfileProviderSchema = Type.Object(
  {
    userId: Type.Number(),
    userRole: Type.Enum(UserRoleEnum),
    providerName: Type.Enum(ProviderNameEnum),
    paymentMethodName: Type.Enum(PaymentMethodNameEnum),
  },
  { additionalProperties: false },
);
export type ProfileProviderDto = Static<typeof ProfileProviderSchema>;
