import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../auth/decorator';
import { ConfigCommonService } from './config-common.service';
import { CommonDto } from './dto/common.dto';
import { FilterCommonDto } from './dto/filter-common.dto';

@ApiTags('Common')
@ApiBearerAuth()
@Controller('common')
export class ConfigCommonController {
  constructor(private readonly configCommonService: ConfigCommonService) {}

  @Get('div')
  @CheckPolicies()
  @ApiOperation({ summary: 'Dropdown options for a given div' })
  @ApiOkResponse({ type: CommonDto, isArray: true })
  findManyByDiv(@Query() filter: FilterCommonDto): Promise<CommonDto[]> {
    return this.configCommonService.findManyByDiv(filter);
  }
}
