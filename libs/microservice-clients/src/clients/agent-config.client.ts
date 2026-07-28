import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { CONFIG_CLIENT, CONFIG_CMD, MICROSERVICE_CALL_TIMEOUT_MS } from '../constants/tcp-clients.constant';
import { CreateAgentDto } from '../dto/agent-config.dto';

@Injectable()
export class AgentConfigClient {
  constructor(
    @Inject(CONFIG_CLIENT)
    private readonly configClient: ClientProxy,
  ) {}

  create(body: CreateAgentDto) {
    return firstValueFrom(
      this.configClient
        .send<void>({ cmd: CONFIG_CMD.CREATE_AGENT_CONFIG }, body)
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }
}
