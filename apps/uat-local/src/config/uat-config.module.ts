import { Global, Module } from '@nestjs/common';
import { UatConfig } from './uat.config';

/**
 * `@Global`, for the same reason `ConfigurationModule` is.
 *
 * It lets `ProviderModule` stay the leaf the design asks for - importing
 * `HttpModule` and nothing of ours - while still injecting `UatConfig`. The
 * Step 7 merchant crons need the same values, and a global provider is cheaper
 * than making one feature module import another just to borrow its config.
 */
@Global()
@Module({
  providers: [UatConfig],
  exports: [UatConfig],
})
export class UatConfigModule {}
