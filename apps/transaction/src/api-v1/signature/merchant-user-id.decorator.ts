import {
  createParamDecorator,
  InternalServerErrorException,
} from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';

/**
 * CLS key holding the authenticated merchant's user id.
 *
 * Exported so the guard that writes it and the decorator that reads it cannot
 * drift apart - a typo on either side would otherwise surface as a silently
 * undefined user id rather than a failure.
 */
export const MERCHANT_USER_ID_KEY = 'merchantUserId';

/**
 * The merchant behind the current request, as established by
 * `MerchantSignatureGuard`.
 *
 * Throws rather than returning `undefined` when the value is absent. That
 * only happens if the handler is missing `@UseGuards(MerchantSignatureGuard)`
 * - in other words, an endpoint that believes it is authenticated but is not.
 * Failing loudly is the whole point: an undefined id would flow on into a
 * query and quietly read or write the wrong merchant's data.
 */
export const MerchantUserId = createParamDecorator((): number => {
  const cls = ClsServiceManager.getClsService();
  const userId = cls.get(MERCHANT_USER_ID_KEY) as unknown;

  if (typeof userId !== 'number') {
    throw new InternalServerErrorException(
      'No authenticated merchant on this request. Is MerchantSignatureGuard applied to this handler?',
    );
  }

  return userId;
});
