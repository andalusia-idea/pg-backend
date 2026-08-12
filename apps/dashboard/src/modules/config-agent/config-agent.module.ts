import { Module } from '@nestjs/common';
import { ConfigAgentController } from './config-agent.controller';
import { ConfigAgentService } from './config-agent.service';

@Module({
  controllers: [ConfigAgentController],
  providers: [ConfigAgentService],
  exports: [ConfigAgentService],
})
export class ConfigAgentModule {}
