import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AGENT_ADMIN_ROLES,
  MERCHANT_ADMIN_ROLES,
} from '../../auth/auth.constant';
import { CheckPolicies, CurrentAuthInfo, Roles } from '../../auth/decorator';
import { AuthInfoDto } from '../../auth/dto/auth-info.dto';
import { ResponseDto, ResponseStatus } from '../../shared/response.dto';
import { CreateAgentDto } from './dto/create-agent.dto';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { ProfileDto } from './dto/profile.dto';
import { UserProfileService } from './user-profile.service';
import { UserService } from './user.service';

@ApiTags('User')
@ApiBearerAuth()
@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userProfileService: UserProfileService,
  ) {}

  /** Any authenticated role - returns only the caller's own profile. */
  @Get('profile')
  @CheckPolicies()
  @ApiOperation({ summary: "The signed-in user's profile" })
  @ApiOkResponse({ type: ProfileDto })
  profile(@CurrentAuthInfo() authInfo: AuthInfoDto): Promise<ProfileDto> {
    return this.userProfileService.profile(authInfo);
  }

  @Post('admin/register-merchant')
  @Roles(...MERCHANT_ADMIN_ROLES)
  @CheckPolicies()
  @ApiOperation({ summary: 'Register a merchant (user + detail + config)' })
  @ApiBody({ type: CreateMerchantDto })
  @ApiCreatedResponse({ type: ResponseDto })
  async registerMerchant(
    @CurrentAuthInfo() authInfo: AuthInfoDto,
    @Body() dto: CreateMerchantDto,
  ): Promise<ResponseDto<null>> {
    await this.userService.registerMerchant(authInfo, dto);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }

  @Post('admin/register-agent')
  @Roles(...AGENT_ADMIN_ROLES)
  @CheckPolicies()
  @ApiOperation({ summary: 'Register an agent (user + detail + config)' })
  @ApiBody({ type: CreateAgentDto })
  @ApiCreatedResponse({ type: ResponseDto })
  async registerAgent(@Body() dto: CreateAgentDto): Promise<ResponseDto<null>> {
    await this.userService.registerAgent(dto);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }
}
