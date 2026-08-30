import { applyDecorators, UseGuards, UseInterceptors } from '@nestjs/common';
import { MerchantResponseInterceptor } from './merchant-response.interceptor';
import { MerchantSignatureGuard } from './merchant-signature.guard';

/**
 * Marks a controller (or handler) as part of the merchant Public API.
 *
 * Applies signature verification and the success envelope together. They are
 * composed rather than applied separately because applying one without the
 * other is always a mistake: a guarded endpoint that skips the interceptor
 * answers failures in the SNAP envelope and successes in some other shape,
 * and an intercepted endpoint that skips the guard is simply unauthenticated.
 *
 * Not to be confused with legacy's `@MerchantApi()`, which was a metadata
 * marker read by a global guard. That opt-in model is gone; this is plain
 * composition with nothing to look up.
 */
export const MerchantEndpoint = () =>
  applyDecorators(
    UseGuards(MerchantSignatureGuard),
    UseInterceptors(MerchantResponseInterceptor),
  );
