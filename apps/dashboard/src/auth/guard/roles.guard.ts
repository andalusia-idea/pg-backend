import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ApiError } from '../../shared/exception';
import { ROLE } from '../auth.constant';
import { PUBLIC_API_KEY } from '../decorator/public.decorator';
import { ROLES_KEY } from '../decorator/roles.decorator';
import { AuthInfoDto } from '../dto/auth-info.dto';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublicApi = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_API_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublicApi) return true;

    const requiredRoles = this.reflector.getAllAndOverride<ROLE[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const authInfo = request.user as AuthInfoDto | undefined;
    if (!authInfo) throw ApiError.unauthorized();

    if (!requiredRoles.includes(authInfo.role)) {
      throw ApiError.forbidden(
        `Role '${authInfo.role}' is not permitted to access this resource`,
      );
    }

    return true;
  }
}
