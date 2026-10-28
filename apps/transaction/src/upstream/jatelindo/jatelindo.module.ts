import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import {
  JatelindoTransferAuthService,
  JatelindoTransferCallbackService,
  JatelindoTransferManualController,
  JatelindoTransferOtherService,
  JatelindoTransferService,
} from './transfer';
import { JatelindoRequestAuthService } from './helper/jatelindo-request-auth.service';

@Module({
  imports: [HttpModule],
  controllers: [JatelindoTransferManualController],
  providers: [
    JatelindoTransferAuthService,
    JatelindoTransferService,
    JatelindoRequestAuthService,
    JatelindoTransferOtherService,
    JatelindoTransferCallbackService,
  ],
  exports: [
    JatelindoTransferAuthService,
    JatelindoTransferService,
    JatelindoRequestAuthService,
    JatelindoTransferOtherService,
    JatelindoTransferCallbackService,
  ],
})
export class JatelindoModule {}
