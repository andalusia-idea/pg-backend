import { Inject, Injectable } from '@nestjs/common';
import {
  AUTH_CLIENT,
  CONFIG_CLIENT,
  CONFIG_CMD,
  MICROSERVICE_CALL_TIMEOUT_MS,
} from '../microservice.constant';
import { ClientProxy } from '@nestjs/microservices';
import { FilterProfileProviderDto, ProfileProviderDto } from '../dto';
import { firstValueFrom, timeout } from 'rxjs';

@Injectable()
export class ProfileClient {
  constructor(
    @Inject(AUTH_CLIENT)
    private readonly authClient: ClientProxy,

    @Inject(CONFIG_CLIENT)
    private readonly configClient: ClientProxy,
  ) {}

  findProfileProvider(payload: FilterProfileProviderDto) {
    return firstValueFrom(
      this.configClient
        .send<ProfileProviderDto>(
          {
            cmd: CONFIG_CMD.FIND_PROFILE_PROVIDER,
          },
          payload,
        )
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }
}
