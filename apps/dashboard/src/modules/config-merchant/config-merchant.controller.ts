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
import { CheckPolicies } from '../../auth/decorator';
import { ParseDtoArrayPipe } from '../../shared/pipe';
import { ResponseDto, ResponseStatus } from '../../shared/response.dto';
import { ConfigMerchantService } from './config-merchant.service';
import {
  MerchantConfigDto,
  MerchantIntervalDto,
} from './dto/merchant-config.dto';
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
}
