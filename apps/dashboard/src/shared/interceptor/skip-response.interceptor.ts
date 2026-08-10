import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_INTERCEPTOR = 'SKIP_RESPONSE_INTERCEPTOR';

/** Opt a handler out of the ResponseDto envelope (file downloads, CSV, metrics). */
export const SkipResponseInterceptor = () =>
  SetMetadata(SKIP_RESPONSE_INTERCEPTOR, true);
