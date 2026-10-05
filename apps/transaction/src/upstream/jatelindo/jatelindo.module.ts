import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import {
  JatelindoTransferAuthService,
  JatelindoTransferManualController,
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
  ],
  exports: [
    JatelindoTransferAuthService,
    JatelindoTransferService,
    JatelindoRequestAuthService,
  ],
})
export class JatelindoModule {}
