import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthInfoDto } from '../dto/auth-info.dto';

/** Injects the authenticated principal that JwtStrategy put on the request. */
export const CurrentAuthInfo = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthInfoDto => {
    const request = context.switchToHttp().getRequest<Request>();
    return request.user as AuthInfoDto;
  },
);
