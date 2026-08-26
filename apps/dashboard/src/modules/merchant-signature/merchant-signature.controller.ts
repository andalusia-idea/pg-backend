import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies, CurrentAuthInfo } from '../../auth/decorator';
import { AuthInfoDto } from '../../auth/dto/auth-info.dto';
import { ResponseDto, ResponseStatus } from '../../shared/response.dto';
import { MerchantSignatureStatusDto } from './dto/merchant-signature-status.dto';
import { RegisterWebhookUrlDto } from './dto/register-webhook-url.dto';
import { MerchantSignatureService } from './merchant-signature.service';

@ApiTags('Merchant Signature')
@ApiBearerAuth()
@Controller('merchant-signature')
export class MerchantSignatureController {
  constructor(
    private readonly merchantSignatureService: MerchantSignatureService,
  ) {}

  /**
   * Acts on the caller's own signature record, never an arbitrary merchant's -
   * the userId comes from the token, not the request.
   */
  @Get('generate-secret-key')
  @CheckPolicies()
  @ApiOperation({
    summary: "Rotate and return the caller's shared secret (shown once)",
  })
  @ApiOkResponse({ type: String })
  generateSharedSecretKey(
    @CurrentAuthInfo() authInfo: AuthInfoDto,
  ): Promise<string> {
    return this.merchantSignatureService.generateSharedSecretKey(authInfo);
  }

  @Post('register-webhook-url')
  @CheckPolicies()
  @ApiOperation({ summary: 'Register payin and payout webhook URLs' })
  @ApiBody({ type: RegisterWebhookUrlDto })
  async registerWebhookUrl(
    @CurrentAuthInfo() authInfo: AuthInfoDto,
    @Body() dto: RegisterWebhookUrlDto,
  ): Promise<ResponseDto<null>> {
    // Legacy did not await this, so a failed write still returned 201 and the
    // rejection surfaced as an unhandled promise rejection instead of a response.
    await this.merchantSignatureService.registerWebhook(authInfo, dto);
    return new ResponseDto({ status: ResponseStatus.CREATED });
  }

  /**
   * Backs the merchant detail page's "Has Generated Key On" display and
   * pre-fills the webhook form on reopen. Newly added - see
   * docs/dashboard-migration.md §2.1, row 39 (no legacy equivalent).
   */
  @Get('status')
  @CheckPolicies()
  @ApiOperation({ summary: "The caller's own signature status" })
  @ApiOkResponse({ type: MerchantSignatureStatusDto })
  status(
    @CurrentAuthInfo() authInfo: AuthInfoDto,
  ): Promise<MerchantSignatureStatusDto> {
    return this.merchantSignatureService.status(authInfo);
  }
}
