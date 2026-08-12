import { Module } from '@nestjs/common';
import { AgentDetailController } from './agent-detail.controller';
import { AgentDetailService } from './agent-detail.service';

@Module({
  controllers: [AgentDetailController],
  providers: [AgentDetailService],
  exports: [AgentDetailService],
})
export class AgentDetailModule {}
