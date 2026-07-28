import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { AUTH_CLIENT, AUTH_CMD, MICROSERVICE_CALL_TIMEOUT_MS } from '../constants/tcp-clients.constant';
import {
  FindMerchantsAndAgentsByIdsDto,
  FindProfileBankDto,
  MerchantsAndAgentsByIdsResultDto,
  ProfileBankDto,
} from '../dto/user-auth.dto';

@Injectable()
export class UserAuthClient {
  constructor(
    @Inject(AUTH_CLIENT)
    private readonly authClient: ClientProxy,
  ) {}

  findAllMerchantsAndAgentsByIds(filter: FindMerchantsAndAgentsByIdsDto) {
    return firstValueFrom(
      this.authClient
        .send<MerchantsAndAgentsByIdsResultDto>(
          { cmd: AUTH_CMD.FIND_ALL_MERCHANTS_AND_AGENTS_BY_IDS },
          filter,
        )
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }

  findProfileBank(filter: FindProfileBankDto) {
    return firstValueFrom(
      this.authClient
        .send<ProfileBankDto>({ cmd: AUTH_CMD.FIND_PROFILE_BANK }, filter)
        .pipe(timeout(MICROSERVICE_CALL_TIMEOUT_MS)),
    );
  }
}
