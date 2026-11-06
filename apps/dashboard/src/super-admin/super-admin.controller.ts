import { Body, Controller, Get, Post } from '@nestjs/common';
import { SuperAdminService } from './super-admin.service';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ROLE, Roles } from '../auth';
import { ParseDtoArrayPipe, ResponseDto, ResponseStatus } from '../shared';
import { CreateAdminDto, ResetPasswordDto, UpsertBaseFeeDto } from './dto';
import { BaseFeeDto } from '../modules/config-fee';

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

  @Post('base-fee')
  @ApiOperation({ summary: 'Upsert Base Fee Each Provider / Upstream' })
  @ApiCreatedResponse({ type: ResponseDto })
  async upsertBaseFee(
    @Body(ParseDtoArrayPipe(UpsertBaseFeeDto))
    body: UpsertBaseFeeDto[],
  ) {
    await this.service.upsertBaseFee(body);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }

  @Get('base-fee')
  @ApiOperation({
    summary: 'Base Fee, including inactive and soft-deleted rows',
    description:
      'The configuration view behind POST /super-admin/base-fee. GET /fee/config ' +
      'is the operational read and excludes soft-deleted rows.',
  })
  @ApiOkResponse({ type: BaseFeeDto, isArray: true })
  async findAllBaseFee(): Promise<BaseFeeDto[]> {
    return this.service.findAllBaseFee();
  }
}
