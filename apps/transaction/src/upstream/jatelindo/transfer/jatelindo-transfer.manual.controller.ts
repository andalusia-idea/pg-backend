import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { JatelindoTransferAuthService } from './jatelindo-transfer.auth.service';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppConfig } from '@app/configuration';
import { AjvPipe, ProviderNameEnum } from '@app/microservice';
import {
  UpstreamException,
  type UpstreamTransferRequestDto,
  UpstreamTransferRequestSchema,
} from '@app/upstream';
import { JatelindoTransferOtherService } from './jatelindo-transfer.other.service';
import { JatelindoTransferService } from './jatelindo-transfer.service';

@ApiTags('Upstream - Jatelindo Transfer (Manual test)')
@Controller('upstream/jatelindo/transfer')
export class JatelindoTransferManualController {
  private readonly logger = new Logger(JatelindoTransferManualController.name);

  constructor(
    private readonly appConfig: AppConfig,

    private readonly transferAuthService: JatelindoTransferAuthService,
    private readonly transferService: JatelindoTransferService,
    private readonly transferOtherService: JatelindoTransferOtherService,
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

  @Get('balance')
  @ApiOperation({ summary: 'Check Balance' })
  async balance() {
    this.assertNotProduction();
    return this.surfaceUpstreamErrors(async () => {
      const balance = await this.transferOtherService.balanceInquiry();
      return balance;
    });
  }

  @Get('status/:systemReference')
  @ApiOperation({ summary: 'Transaction Status by SystemReference' })
  async transactionStatus(@Param('systemReference') systemReference: string) {
    this.assertNotProduction();
    return this.surfaceUpstreamErrors(async () => {
      const status = await this.transferOtherService.transactionStatus({
        systemReference,
        providerReference: null,
      });
      return status;
    });
  }

  @Post('create-transfer')
  @ApiOperation({ summary: 'Create Transfer' })
  @ApiBody({ schema: UpstreamTransferRequestSchema as Record<string, any> })
  async createTransfer(
    @Body(AjvPipe<UpstreamTransferRequestDto>(UpstreamTransferRequestSchema))
    body: UpstreamTransferRequestDto,
  ) {
    this.assertNotProduction();
    return this.surfaceUpstreamErrors(async () => {
      const transfer = await this.transferService.createTransfer(body);
      return transfer;
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
