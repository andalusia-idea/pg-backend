import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { DisbursementWebhookService } from '../api-v1/disbursement';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProviderPrincipalInterceptor } from './provider-principal.interceptor';
import { ProviderNameEnum } from '@app/microservice';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Value } from '@sinclair/typebox/value';
import {
  JatelindoTransferCallbackDto,
  JatelindoTransferCallbackSchema,
  JatelindoTransferCallbackService,
} from '../upstream/jatelindo';

@ApiTags('Upstream Callback')
@Controller('callback/jatelindo')
@UseInterceptors(new ProviderPrincipalInterceptor(ProviderNameEnum.JATELINDO))
export class JatelindoCallbackController {
  private readonly logger = new Logger(JatelindoCallbackController.name);

  constructor(
    private readonly disbursementWebhookService: DisbursementWebhookService,

    private readonly transferCallbackService: JatelindoTransferCallbackService,
  ) {}

  @Post('transfer')
  @HttpCode(HttpStatus.OK)
  // @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Jatelindo Single Transfer Asynchoronous' })
  async qris(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!Value.Check(JatelindoTransferCallbackSchema, body)) {
      this.logger.warn({
        msg: 'Malformed Jatelindo transfer callback',
        sourceIp: request.ip,
        errors: [...Value.Errors(JatelindoTransferCallbackSchema, body)]
          .slice(0, 3)
          .map((error) => `${error.path} ${error.message}`),
      });
      // 200: their retry would send the same malformed body three more times.
      return { received: true };
    }

    const payload = body as JatelindoTransferCallbackDto;
    const translation = this.transferCallbackService.translate(
      payload,
      request.ip,
    );

    if (!translation.accepted) return { received: true };

    const outcome = await this.disbursementWebhookService.handle(
      translation.webhook,
    );

    if (outcome.retry) {
      void reply.status(HttpStatus.INTERNAL_SERVER_ERROR);
      return { received: false };
    }

    return { received: true };
  }
}
