import { Module } from '@nestjs/common';
import { SettlereconController } from './settlerecon.controller';
import { SettlereconService } from './settlerecon.service';

@Module({
  imports: [],
  controllers: [SettlereconController],
  providers: [SettlereconService],
})
export class SettlereconModule {}
