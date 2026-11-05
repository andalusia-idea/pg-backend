import { Body, Controller, Post } from '@nestjs/common';
import { SuperAdminService } from './super-admin.service';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ROLE, Roles } from '../auth';
import { ResponseDto, ResponseStatus } from '../shared';
import { CreateAdminDto, ResetPasswordDto } from './dto';

@Controller('super-admin')
@ApiBearerAuth()
@ApiTags('Super Admin')
@Roles(ROLE.SUPER_ADMIN)
export class SuperAdminController {
  constructor(private readonly service: SuperAdminService) {}

  @Post('register-admin')
  @ApiOperation({ summary: 'Register an admin with profile' })
  @ApiCreatedResponse({ type: ResponseDto })
  async registerAdmin(@Body() dto: CreateAdminDto) {
    await this.service.registerAdmin(dto);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reseting Super Admin Account' })
  @ApiCreatedResponse({ type: ResponseDto })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.service.resetPassword(dto);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }
}
