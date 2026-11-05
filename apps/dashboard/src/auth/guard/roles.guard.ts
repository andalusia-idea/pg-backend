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

    // SUPER_ADMIN satisfies every @Roles(), including one added specifically to
    // exclude it. Two consequences worth keeping in mind:
    //
    //  - AGENT_ADMIN_ROLES lists SUPER_ADMIN explicitly while this grants it
    //    implicitly. The lists are therefore descriptive, not exhaustive - do
    //    not read the absence of SUPER_ADMIN from a @Roles() as a denial.
    //  - It reaches an endpoint with no config.Agent row behind it, which is
    //    why user.service's registrarIsAgent check cannot be removed.
    if (authInfo.role === ROLE.SUPER_ADMIN) return true;

    if (!requiredRoles.includes(authInfo.role)) {
      throw ApiError.forbidden(
        `Role '${authInfo.role}' is not permitted to access this resource`,
      );
    }

    return true;
  }
}
