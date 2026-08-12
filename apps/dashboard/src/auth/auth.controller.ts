import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
// `import type` is required: this type appears in a decorated signature and the
// build runs with isolatedModules + emitDecoratorMetadata.
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { CurrentAuthInfo, PublicApi } from './decorator';
import { AuthDto } from './dto/auth.dto';
import { AuthInfoDto } from './dto/auth-info.dto';
import { LoginDto } from './dto/login.dto';
import { LocalAuthGuard } from './guard/local-auth.guard';

@ApiTags('Auth')
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @PublicApi()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiOperation({ summary: 'Login for all roles' })
  @ApiBody({ type: LoginDto })
  @ApiCreatedResponse({ type: AuthDto })
  login(@Req() request: Request): Promise<AuthDto> {
    // LocalAuthGuard has already validated the credentials and put the
    // principal on the request.
    return this.authService.login(request.user as AuthInfoDto);
  }

  @Post('auth-info')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Echo the principal decoded from the bearer token' })
  authInfo(@CurrentAuthInfo() authInfo: AuthInfoDto): AuthInfoDto {
    return authInfo;
  }
}
