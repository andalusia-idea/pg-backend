import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { map, Observable } from 'rxjs';
import { Page } from '../pagination/pagination';
import { ResponseDto, ResponseStatus } from '../response.dto';
import { SKIP_RESPONSE_INTERCEPTOR } from './skip-response.interceptor';

/**
 * Wraps every handler return value in the ResponseDto envelope the dashboard
 * frontend expects. A returned `Page<T>` populates `pagination`; a handler that
 * already returns a ResponseDto is passed through untouched.
 */
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ResponseDto<T> | null
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ResponseDto<T> | null> {
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_INTERCEPTOR,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return next.handle() as Observable<null>;

    const request = context.switchToHttp().getRequest<Request>();
    if (request.path === '/metrics') {
      return next.handle() as unknown as Observable<ResponseDto<T>>;
    }

    return next.handle().pipe(
      map((response) => {
        if (response instanceof ResponseDto) return response;

        if (response instanceof Page) {
          return new ResponseDto<T>({
            status: ResponseStatus.SUCCESS,
            data: response.data as T,
            pagination: response.pagination,
          });
        }

        return new ResponseDto<T>({
          status: ResponseStatus.SUCCESS,
          data: response,
        });
      }),
    );
  }
}
