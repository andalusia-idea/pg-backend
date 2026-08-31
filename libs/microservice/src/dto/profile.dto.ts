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
    paymentMethodName: Type.Enum(PaymentMethodNameEnum),
  },
  { additionalProperties: false },
);
export type FilterProfileProviderDto = Static<
  typeof FilterProfileProviderSchema
>;

export const FilterProfileBankSchema = Type.Object(
  {
    userId: Type.Number(),
  },
  { additionalProperties: false },
);
export type FilterProfileBankDto = Static<typeof FilterProfileBankSchema>;

/// RESPONSE
export const ProfileProviderSchema = Type.Object(
  {
    userId: Type.Number(),
    userRole: Type.Enum(UserRoleEnum),
    providerName: Type.Enum(ProviderNameEnum),
  },
  { additionalProperties: false },
);
export type ProfileProviderDto = Static<typeof ProfileProviderSchema>;

export const ProfileBankSchema = Type.Object(
  {
    userId: Type.Number(),
    profileId: Type.Number(),
    userRole: Type.Enum(UserRoleEnum),
    bankCode: Type.String(),
    bankName: Type.String(),
    accountNumber: Type.String(),
    accountHolderName: Type.String(),
  },
  { additionalProperties: false },
);
export type ProfileBankDto = Static<typeof ProfileBankSchema>;
