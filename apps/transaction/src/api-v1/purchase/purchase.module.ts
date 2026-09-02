import { Module } from '@nestjs/common';
import { MotionPayModule } from '../../upstream/motionpay';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';

/**
 * `MotionPayModule` is imported rather than relying on the app module having
 * registered it: that registration exists to serve the provider test
 * controllers, and this module's own dependency on `MotionPayQRISService`
 * should not quietly break the day those go away.
 *
 * `MicroserviceModule` (the TCP clients) and `PrismaModule` are `@Global`, so
 * they need no import here.
 */
@Module({
  imports: [MotionPayModule],
  controllers: [PurchaseController],
  providers: [PurchaseService],
})
export class PurchaseModule {}
