import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../auth/decorator';
import { ConfigFeeService } from './config-fee.service';
import { BaseFeeDto } from './dto/base-fee.dto';

@ApiTags('Fee')
@ApiBearerAuth()
@Controller('fee')
export class ConfigFeeController {
  constructor(private readonly configFeeService: ConfigFeeService) {}

  @Get('config')
  @CheckPolicies()
  @ApiOperation({ summary: 'All provider fee configurations' })
  @ApiOkResponse({ type: BaseFeeDto, isArray: true })
  findAllConfig(): Promise<BaseFeeDto[]> {
    return this.configFeeService.findAllConfig();
  }
}
