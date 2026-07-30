import { MessagePattern, Payload } from '@nestjs/microservices';
import { UserService } from './user.service';
import {
  AjvPipe,
  AUTH_CMD,
  type FilterProfileBankDto,
  FilterProfileBankSchema,
} from '@app/microservice';
import { UsePipes } from '@nestjs/common';

export class UserController {
  constructor(private readonly userService: UserService) {}

  @MessagePattern({ cmd: AUTH_CMD.FIND_PROFILE_BANK })
  @UsePipes(AjvPipe<FilterProfileBankDto>(FilterProfileBankSchema))
  findProfileBank(@Payload() payload: FilterProfileBankDto) {
    return this.userService.findProfileBank(payload);
  }
}
