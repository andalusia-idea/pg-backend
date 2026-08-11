import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../auth/decorator';
import { ResponseDto, ResponseStatus } from '../../shared/response.dto';
import { AgentDetailService } from './agent-detail.service';
import { AgentDto, AgentNameDto } from './dto/agent.dto';
import { UpdateAgentDetailDto } from './dto/update-agent-detail.dto';

@ApiTags('Agent Detail')
@ApiBearerAuth()
@Controller('agent-detail')
export class AgentDetailController {
  constructor(private readonly agentDetailService: AgentDetailService) {}

  @Get()
  @CheckPolicies()
  @ApiOperation({ summary: 'List agents' })
  @ApiOkResponse({ type: AgentDto, isArray: true })
  findAll(): Promise<AgentDto[]> {
    return this.agentDetailService.findAll();
  }

  /**
   * Route order matters: this must precede `:userId`, otherwise Express matches
   * "dropdown" as a userId and ParseIntPipe rejects it.
   *
   * Legacy marked this @PublicApi(), leaking the agent list to anyone who could
   * reach the host. Removed - the merchant equivalent was never public.
   */
  @Get('dropdown')
  @CheckPolicies()
  @ApiOperation({ summary: 'Agent id + name pairs for dropdowns' })
  @ApiOkResponse({ type: AgentNameDto, isArray: true })
  findAllNames(): Promise<AgentNameDto[]> {
    return this.agentDetailService.findAllNames();
  }

  @Get(':userId')
  @CheckPolicies()
  @ApiOperation({ summary: 'Agent by userId' })
  @ApiOkResponse({ type: AgentDto })
  findOne(@Param('userId', ParseIntPipe) userId: number): Promise<AgentDto> {
    return this.agentDetailService.findOneThrow(userId);
  }

  @Patch('update/:userId')
  @CheckPolicies()
  @ApiOperation({ summary: 'Update agent by userId' })
  @ApiBody({ type: UpdateAgentDetailDto })
  async update(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() dto: UpdateAgentDetailDto,
  ): Promise<ResponseDto<null>> {
    await this.agentDetailService.update(userId, dto);
    return new ResponseDto({ status: ResponseStatus.UPDATED });
  }
}
