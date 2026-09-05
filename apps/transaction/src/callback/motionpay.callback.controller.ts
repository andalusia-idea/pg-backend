import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Value } from '@sinclair/typebox/value';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PurchaseWebhookService } from '../api-v1/purchase';
import {
  MotionPayQrisCallbackDto,
  MotionPayQrisCallbackSchema,
  MotionPayQrisCallbackService,
} from '../upstream/motionpay';

@ApiTags('Upstream Callback')
@Controller('callback/motionpay')
export class MotionPayCallbackController {
  private readonly logger = new Logger(MotionPayCallbackController.name);

  constructor(
    private readonly qrisCallbackService: MotionPayQrisCallbackService,
    private readonly purchaseWebhookService: PurchaseWebhookService,
  ) {}

  /**
   * QRIS Payment Notification, registered with Flash at
   * *Product Configuration → QRIS* on their merchant dashboard.
   *
   * **Deliberately not a `@MerchantEndpoint()`.** This is inbound from a
   * provider, not from a merchant: there is no `X-Client-Id`, no signature to
   * verify, and answering in the SNAP merchant envelope would be meaningless to
   * MotionPay, who only look at the HTTP status.
   *
   * Excluded from Swagger because publishing the shape of an unauthenticated
   * endpoint that moves money is free reconnaissance.
   *
   * The status code carries the whole protocol. MotionPay retries a non-200 up
   * to three times at five-minute intervals and then drops the callback
   * permanently, so:
   *
   * - **200** — handled, or nothing a retry could fix (unknown transaction,
   *   already settled, rejected origin, malformed body).
   * - **500** — a transient failure on our side. Their retry is genuinely
   *   useful, so we ask for it.
   *
   * Note the asymmetry: we answer 200 to a rejected origin. It is not an
   * acknowledgement that anything was done - it is refusing to let an attacker
   * schedule three more rounds of work by sending one request.
   */
  @Post('qris')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'MotionPay QRIS payment notification' })
  async qris(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ received: boolean }> {
    // Validated here rather than by a pipe, so a malformed payload is still
    // logged with its source before being discarded. A pipe would reject it
    // before we ever saw where it came from - which is the interesting part
    // when the endpoint is unauthenticated.
    if (!Value.Check(MotionPayQrisCallbackSchema, body)) {
      this.logger.warn({
        msg: 'Malformed MotionPay QRIS callback',
        sourceIp: request.ip,
        errors: [...Value.Errors(MotionPayQrisCallbackSchema, body)]
          .slice(0, 3)
          .map((error) => `${error.path} ${error.message}`),
      });
      // 200: their retry would send the same malformed body three more times.
      return { received: true };
    }

    const payload = body as MotionPayQrisCallbackDto;

    // Two steps, and the split is the point: MotionPay's adapter turns their
    // wire format into our neutral one and decides whether the origin is
    // acceptable; the purchase layer decides what it means for a transaction.
    // Neither knows about the other.
    const translation = this.qrisCallbackService.translate(payload, request.ip);
    if (!translation.accepted) return { received: true };

    const outcome = await this.purchaseWebhookService.handle(
      translation.webhook,
    );

    if (outcome.retry) {
      void reply.status(HttpStatus.INTERNAL_SERVER_ERROR);
      return { received: false };
    }

    return { received: true };
  }
}
