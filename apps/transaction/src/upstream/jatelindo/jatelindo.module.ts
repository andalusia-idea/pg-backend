import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import {
  JatelindoTransferAuthService,
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
  ],
  exports: [
    JatelindoTransferAuthService,
    JatelindoTransferService,
    JatelindoRequestAuthService,
    JatelindoTransferOtherService,
  ],
})
export class JatelindoModule {}
