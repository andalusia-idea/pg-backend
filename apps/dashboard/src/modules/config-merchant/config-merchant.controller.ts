import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { MERCHANT_TERMS_ROLES } from '../../auth/auth.constant';
import { CheckPolicies } from '../../auth/decorator';
import { Roles } from '../../auth/decorator/roles.decorator';
import { ParseDtoArrayPipe } from '../../shared/pipe';
import { ResponseDto, ResponseStatus } from '../../shared/response.dto';
import { ConfigMerchantService } from './config-merchant.service';
import {
  MerchantConfigDto,
  MerchantIntervalDto,
} from './dto/merchant-config.dto';
import {
  MerchantSettlementPolicyDto,
  UpsertMerchantSettlementPolicyDto,
} from './dto/settlement-policy.dto';
import {
  UpsertMerchantAgentShareholderDto,
  UpsertMerchantFeeDto,
} from './dto/upsert-merchant-fee.dto';

@ApiTags('Merchant Config')
@ApiBearerAuth()
@Controller('merchant')
export class ConfigMerchantController {
  constructor(private readonly configMerchantService: ConfigMerchantService) {}

  @Get(':merchantId/interval')
  @CheckPolicies()
  @ApiOperation({ summary: 'Merchant settlement interval' })
  @ApiOkResponse({ type: MerchantIntervalDto })
  findMerchantIntervalById(
    @Param('merchantId', ParseIntPipe) merchantId: number,
  ): Promise<MerchantIntervalDto> {
    return this.configMerchantService.findMerchantIntervalById(merchantId);
  }

  @Get(':merchantId/config')
  @CheckPolicies()
  @ApiOperation({ summary: 'Merchant fee and shareholder configuration' })
  @ApiOkResponse({ type: MerchantConfigDto })
  findAllConfigByMerchantId(
    @Param('merchantId', ParseIntPipe) merchantId: number,
  ): Promise<MerchantConfigDto> {
    return this.configMerchantService.findAllConfigByMerchantId(merchantId);
  }

  @Post(':merchantId/provider')
  @CheckPolicies()
  @ApiOperation({ summary: 'Upsert merchant fee configuration (batch)' })
  @ApiBody({ type: UpsertMerchantFeeDto, isArray: true })
  async upsertProvider(
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Body(ParseDtoArrayPipe(UpsertMerchantFeeDto))
    body: UpsertMerchantFeeDto[],
  ): Promise<ResponseDto<null>> {
    await this.configMerchantService.upsertProvider(merchantId, body);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }

  @Post(':merchantId/agent-shareholder')
  @CheckPolicies()
  @ApiOperation({ summary: 'Upsert agent shareholder configuration (batch)' })
  @ApiBody({ type: UpsertMerchantAgentShareholderDto, isArray: true })
  async upsertAgentShareholder(
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Body(ParseDtoArrayPipe(UpsertMerchantAgentShareholderDto))
    body: UpsertMerchantAgentShareholderDto[],
  ): Promise<ResponseDto<null>> {
    await this.configMerchantService.upsertAgentShareholder(merchantId, body);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }

  @Post(':merchantId/settlement-policy')
  @Roles(...MERCHANT_TERMS_ROLES)
  @CheckPolicies()
  @ApiOperation({
    summary: 'Upsert merchant settlement terms (batch)',
    description:
      'When this merchant\'s money stops being "coming" and becomes theirs ' +
      'to spend. A new effectiveFrom supersedes the terms before it, closing ' +
      'them in the same transaction; the same effectiveFrom corrects that row ' +
      "in place. Send '*' as paymentMethodName for the merchant's default, or " +
      'a method name to override just that one.',
  })
  @ApiBody({ type: UpsertMerchantSettlementPolicyDto, isArray: true })
  async upsertSettlementPolicy(
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Body(ParseDtoArrayPipe(UpsertMerchantSettlementPolicyDto))
    body: UpsertMerchantSettlementPolicyDto[],
  ): Promise<ResponseDto<null>> {
    await this.configMerchantService.upsertSettlementPolicy(merchantId, body);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }

  @Get(':merchantId/settlement-policy')
  @Roles(...MERCHANT_TERMS_ROLES)
  @CheckPolicies()
  @ApiOperation({
    summary: 'Merchant settlement terms, superseded rows included',
    description:
      'Newest terms first per method. Superseded rows are kept because ' +
      'effectiveFrom is part of the key: an old row is what an old payout was ' +
      'computed from.',
  })
  @ApiOkResponse({ type: MerchantSettlementPolicyDto, isArray: true })
  findAllSettlementPolicyByMerchantId(
    @Param('merchantId', ParseIntPipe) merchantId: number,
  ): Promise<MerchantSettlementPolicyDto[]> {
    return this.configMerchantService.findAllSettlementPolicyByMerchantId(
      merchantId,
    );
  }
}
