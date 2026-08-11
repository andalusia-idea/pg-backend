import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../auth/decorator';
import { MerchantDto } from '../merchant-detail/dto/merchant.dto';
import { ConfigAgentService } from './config-agent.service';

@ApiTags('Agent')
@ApiBearerAuth()
@Controller('agent')
export class ConfigAgentController {
  constructor(private readonly configAgentService: ConfigAgentService) {}

  @Get(':agentId/merchants')
  @CheckPolicies()
  @ApiOperation({ summary: 'Merchants this agent holds a share in' })
  @ApiOkResponse({ type: MerchantDto, isArray: true })
  findMerchantsByAgentId(
    @Param('agentId', ParseIntPipe) agentId: number,
  ): Promise<MerchantDto[]> {
    return this.configAgentService.findMerchantsByAgentId(agentId);
  }
}
