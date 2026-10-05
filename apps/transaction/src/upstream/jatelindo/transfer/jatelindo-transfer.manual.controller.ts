import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JatelindoTransferAuthService } from './jatelindo-transfer.auth.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppConfig } from '@app/configuration';
import { ProviderNameEnum } from '@app/microservice';
import { UpstreamException } from '@app/upstream';

@ApiTags('Upstream - Jatelindo Transfer (Manual test)')
@Controller('upstream/jatelindo/transfer')
export class JatelindoTransferManualController {
  private readonly logger = new Logger(JatelindoTransferManualController.name);

  constructor(
    private readonly transferAuthService: JatelindoTransferAuthService,
    private readonly appConfig: AppConfig,
  ) {}

  @Get('login')
  @ApiOperation({ summary: 'Login and verify transfer credentials' })
  async login() {
    this.assertNotProduction();
    return this.surfaceUpstreamErrors(async () => {
      const token = await this.transferAuthService.getToken();
      return {
        ok: true,
        token: `${token}`,
      };
    });
  }

  private async surfaceUpstreamErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof UpstreamException) {
        this.logger.error({
          msg: 'MotionPay Transfer call failed',
          provider: error.provider,
          reason: error.message,
          context: error.context,
        });

        throw new HttpException(
          {
            provider: error.provider,
            message: error.message,
            context: error.context,
          },
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw error;
    }
  }

  private assertNotProduction(): void {
    if (this.appConfig.IS_PRODUCTION) {
      throw new ForbiddenException(
        `${ProviderNameEnum.JATELINDO} transfer manual test endpoints are disabled in production`,
      );
    }
  }
}
