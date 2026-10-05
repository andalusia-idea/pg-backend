import { Static, Type } from '@sinclair/typebox';

export const JatelindoLoginResponseSchema = Type.Object({
  LoginResponse: Type.Array(
    Type.Object({
      token: Type.String(),
    }),
  ),
  status: Type.Object({
    responseCode: Type.String(),
    message: Type.String(),
    description: Type.String(),
  }),
});
export type JatelindoLoginResponseDto = Static<
  typeof JatelindoLoginResponseSchema
>;
