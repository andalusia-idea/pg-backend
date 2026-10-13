import {
  AUDIT_USER_ID_PATH,
  PROVIDER_CALLBACK_USER_ID,
  type ProviderNameEnum,
} from '@app/microservice';
import { Logger } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import type { Observable } from 'rxjs';

/**
 * Attributes everything an upstream callback writes to that provider's machine
 * principal.
 *
 * Callback routes are unauthenticated by design - a provider posting a payment
 * notification has no `X-Client-Id` and no signature - so no guard runs and
 * nothing puts a principal in CLS. The audit extension then stamps `updatedAt`
 * and leaves `updatedBy` null, which is silent because those columns are
 * nullable: the row recording that a payment arrived ends up attributed to
 * nobody.
 *
 * Per provider rather than one shared `SYSTEM_USER_ID`, so the trail can answer
 * *whose* notification changed a row. On a disputed transaction that is the
 * first question, and a single system id cannot answer it.
 *
 * An interceptor rather than a guard because there is nothing to authorize, and
 * the `ClsModule` middleware has already opened the request's context by the
 * time this runs - so this only has to fill it in.
 *
 * Takes its provider as a constructor argument and reads CLS through
 * `ClsServiceManager` rather than injection, so it can be applied inline:
 *
 * ```ts
 * @UseInterceptors(new ProviderPrincipalInterceptor(ProviderNameEnum.MOTIONPAY))
 * ```
 *
 * That keeps the provider visible on the controller it belongs to, instead of
 * needing one registered provider class per upstream. The static manager is the
 * same store the injected `ClsService` uses - `merchant-user-id.decorator.ts`
 * and the audit extension both already reach for it this way.
 */
export class ProviderPrincipalInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ProviderPrincipalInterceptor.name);
  private readonly userId: number;

  constructor(private readonly providerName: ProviderNameEnum) {
    this.userId = PROVIDER_CALLBACK_USER_ID[providerName];
  }

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const cls = ClsServiceManager.getClsService();

    // `set` throws outside an active context, and on these routes that would
    // surface as a 500 - which MotionPay reads as "retry me", three times, and
    // then drops the notification permanently. A payment we never record is a
    // far worse outcome than a row we cannot attribute, so an absent context is
    // logged and stepped over rather than thrown.
    //
    // It should not happen: `ClsModule` is registered in `app.module.ts` with
    // `middleware: { mount: true }`, so every HTTP request arrives with a
    // context already open. This is here for the day someone changes that.
    if (!cls.isActive()) {
      this.logger.error({
        msg: 'No CLS context on a callback route; writes will not be attributed',
        providerName: this.providerName,
      });
      return next.handle();
    }

    cls.set(AUDIT_USER_ID_PATH, this.userId);
    return next.handle();
  }
}
