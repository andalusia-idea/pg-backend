import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { CONFIG_CLIENT, CONFIG_CMD, MICROSERVICE_CALL_TIMEOUT_MS } from '../constants/tcp-clients.constant';
import { FindProfileProviderDto, ProfileProviderResultDto } from '../dto/profile-provider.dto';

@Injectable()
export class ProfileProviderConfigClient {
  constructor(
    @Inject(CONFIG_CLIENT)
    private readonly configClient: ClientProxy,
  ) {}

  findProfileProvider(filter: FindProfileProviderDto) {
    return firstValueFrom(
      this.configClient
        .send<ProfileProviderResultDto>(
          { cmd: CONFIG_CMD.FIND_PROFILE_PROVIDER },
          filter,
        )
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }
}
