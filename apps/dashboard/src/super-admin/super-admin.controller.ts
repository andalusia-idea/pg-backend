import { Body, Controller, Get, Post } from '@nestjs/common';
import { SuperAdminService } from './super-admin.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ROLE, Roles } from '../auth';
import { ParseDtoArrayPipe, ResponseDto, ResponseStatus } from '../shared';
import {
  CreateAdminDto,
  ProviderDto,
  ResetPasswordDto,
  SettlementWindowDto,
  UpsertBaseFeeDto,
  UpsertProviderDto,
  UpsertSettlementWindowDto,
} from './dto';
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

  @Post('provider')
  @ApiOperation({
    summary: 'Activate upstream providers',
    description:
      'Brings a partner live. The migrations insert INTERNAL only - every ' +
      'other provider exists because a contract was signed - so until this is ' +
      'called for a partner, its base fees and its settlement windows are both ' +
      'refused and the provider dropdown is empty.',
  })
  @ApiBody({ type: UpsertProviderDto, isArray: true })
  @ApiCreatedResponse({ type: ResponseDto })
  async upsertProvider(
    @Body(ParseDtoArrayPipe(UpsertProviderDto))
    body: UpsertProviderDto[],
  ) {
    await this.service.upsertProvider(body);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }

  @Get('provider')
  @ApiOperation({
    summary: 'Configured providers, retired ones included',
    description:
      'The configuration view behind POST /super-admin/provider. ' +
      'GET common/div?div=PROVIDER is the operational read: it excludes ' +
      'INTERNAL and filters retired rows.',
  })
  @ApiOkResponse({ type: ProviderDto, isArray: true })
  async findAllProvider(): Promise<ProviderDto[]> {
    return this.service.findAllProvider();
  }

  @Post('settlement-window')
  @ApiOperation({
    summary: 'Upsert upstream settlement windows',
    description:
      'When each partner closes a transaction window and releases our money. ' +
      'Transcribe from the partner notice - these rows decide the payout time ' +
      'for every merchant on that rail.',
  })
  @ApiBody({ type: UpsertSettlementWindowDto, isArray: true })
  @ApiCreatedResponse({ type: ResponseDto })
  async upsertSettlementWindow(
    @Body(ParseDtoArrayPipe(UpsertSettlementWindowDto))
    body: UpsertSettlementWindowDto[],
  ) {
    await this.service.upsertSettlementWindow(body);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }

  @Get('settlement-window')
  @ApiOperation({
    summary: 'Upstream settlement windows, retired ones included',
    description:
      'Ordered newest schedule first per rail. A retired window is kept ' +
      'because effectiveFrom is part of the key: it is what an old payout was ' +
      'computed from.',
  })
  @ApiOkResponse({ type: SettlementWindowDto, isArray: true })
  async findAllSettlementWindow(): Promise<SettlementWindowDto[]> {
    return this.service.findAllSettlementWindow();
  }
}
