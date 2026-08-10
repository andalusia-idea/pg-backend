import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { ApiError } from '../../shared/exception';
import { CLS_AUTH_INFO_KEY } from '../auth.constant';
import { PUBLIC_API_KEY } from '../decorator/public.decorator';
import { AuthInfoDto } from '../dto/auth-info.dto';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
  ) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.path === '/metrics') return true;

    const isPublicApi = this.reflector.getAllAndOverride<boolean>(
      PUBLIC_API_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublicApi) return true;

    return super.canActivate(context);
  }

  handleRequest<TUser extends AuthInfoDto>(err: unknown, user: TUser): TUser {
    if (err || !user) throw ApiError.unauthorized();

    // The Prisma audit extension reads authInfo.userId from CLS to stamp
    // createdBy/updatedBy, so this must be set on every authenticated request.
    this.cls.set(CLS_AUTH_INFO_KEY, user);

    return user;
  }
}
