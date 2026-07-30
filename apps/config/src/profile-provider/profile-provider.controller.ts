import { Controller, UsePipes } from '@nestjs/common';
import { ProfileProviderService } from './profile-provider.service';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AjvPipe,
  CONFIG_CMD,
  type FilterProfileProviderDto,
  FilterProfileProviderSchema,
} from '@app/microservice';

@Controller()
export class ProfileProviderController {
  constructor(
    private readonly profileProviderService: ProfileProviderService,
  ) {}

  @MessagePattern({ cmd: CONFIG_CMD.FIND_PROFILE_PROVIDER })
  @UsePipes(AjvPipe<FilterProfileProviderDto>(FilterProfileProviderSchema))
  findProfileProvider(@Payload() payload: FilterProfileProviderDto) {
    return this.profileProviderService.findProfileProvider(payload);
  }
}
