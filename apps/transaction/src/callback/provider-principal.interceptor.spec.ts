import {
  AUDIT_USER_ID_PATH,
  PROVIDER_CALLBACK_USER_ID,
  ProviderNameEnum,
} from '@app/microservice';
import { describe, expect, it } from '@jest/globals';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { firstValueFrom, of } from 'rxjs';
import { ProviderPrincipalInterceptor } from './provider-principal.interceptor';

const context = {} as ExecutionContext;
const handler = (value: unknown = null): CallHandler =>
  ({ handle: () => of(value) }) as CallHandler;

/**
 * Exercised through the real `ClsServiceManager` rather than a mock, because
 * the whole bug this guards against was a principal written to a store or key
 * nothing read back. A mock would assert the call, not the effect.
 */
describe('ProviderPrincipalInterceptor', () => {
  const cls = ClsServiceManager.getClsService();

  it('leaves the calling provider in CLS where the audit extension reads it', () => {
    const seen = cls.run(() => {
      new ProviderPrincipalInterceptor(ProviderNameEnum.MOTIONPAY).intercept(
        context,
        handler(),
      );
      return cls.get<number | undefined>(AUDIT_USER_ID_PATH);
    });

    expect(seen).toBe(PROVIDER_CALLBACK_USER_ID.MOTIONPAY);
  });

  /**
   * The point of per-provider ids over a single `SYSTEM_USER_ID`: a disputed
   * row has to be able to say which upstream moved it.
   */
  it('distinguishes one provider from another', () => {
    const ids = cls.run(() => {
      const seen: unknown[] = [];
      for (const name of [
        ProviderNameEnum.MOTIONPAY,
        ProviderNameEnum.TELEANJAR,
        ProviderNameEnum.JATELINDO,
      ]) {
        new ProviderPrincipalInterceptor(name).intercept(context, handler());
        seen.push(cls.get<number | undefined>(AUDIT_USER_ID_PATH));
      }
      return seen;
    });

    expect(ids).toEqual([
      PROVIDER_CALLBACK_USER_ID.MOTIONPAY,
      PROVIDER_CALLBACK_USER_ID.TELEANJAR,
      PROVIDER_CALLBACK_USER_ID.JATELINDO,
    ]);
    expect(new Set(ids).size).toBe(3);
  });

  /**
   * The callback routes answer MotionPay in HTTP status codes only, so an
   * interceptor that swallowed or reshaped the response would change the retry
   * protocol rather than just the audit trail.
   */
  it('passes the handler result straight through', async () => {
    const expected = { received: true };

    const result = await firstValueFrom(
      new ProviderPrincipalInterceptor(ProviderNameEnum.MOTIONPAY).intercept(
        context,
        handler(expected),
      ),
    );

    expect(result).toBe(expected);
  });

  /**
   * `cls.set` throws outside an active context. On these routes a throw becomes
   * a 500, which MotionPay reads as "retry me" three times before dropping the
   * notification for good - so an unattributed row has to be preferable to a
   * lost payment. Guards the `isActive()` check against being tidied away.
   */
  it('does not throw when there is no CLS context', async () => {
    const expected = { received: true };

    const result = await firstValueFrom(
      new ProviderPrincipalInterceptor(ProviderNameEnum.MOTIONPAY).intercept(
        context,
        handler(expected),
      ),
    );

    expect(result).toBe(expected);
    expect(cls.isActive()).toBe(false);
  });

  /**
   * The writes happen inside the handler, so the principal has to be in place
   * before it runs - not as a side effect of someone subscribing.
   */
  it('sets the principal without waiting for a subscriber', () => {
    const seen = cls.run(() => {
      new ProviderPrincipalInterceptor(ProviderNameEnum.JATELINDO).intercept(
        context,
        handler(),
      );
      return cls.get<number | undefined>(AUDIT_USER_ID_PATH);
    });

    expect(seen).toBe(PROVIDER_CALLBACK_USER_ID.JATELINDO);
  });
});
