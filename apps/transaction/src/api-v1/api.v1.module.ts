import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { MerchantExceptionFilter } from './merchant-exception.filter';
import { PingModule } from './ping';
import { PurchaseModule } from './purchase';

@Module({
  imports: [PingModule, PurchaseModule],
  providers: [
    /**
     * Registered through APP_FILTER so it applies wherever a
     * `MerchantException` is thrown, without every controller having to
     * remember `@UseFilters`. It is `@Catch(MerchantException)`, so nothing
     * outside the merchant API is affected.
     */
    { provide: APP_FILTER, useClass: MerchantExceptionFilter },
  ],
})
export class Apiv1Module {}
