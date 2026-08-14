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
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AppConfig } from '@app/configuration';
import { AjvPipe, ProviderNameEnum } from '@app/microservice';
import { UpstreamException } from '@app/upstream';
import { MotionPayQRISService } from './motionpay.qris.service';
import { MotionPayAuthService } from './motionpay-auth.service';
import {
  type MotionPayCreateQrisRequestDto,
  MotionPayCreateQrisRequestSchema,
} from './dto';

/**
 * Manual test surface for the MotionPay QRIS integration.
 *
 * Exists so the upstream client can be exercised end-to-end from Swagger before
 * the real purchase flow in `src/api` is wired up. It calls MotionPay directly
 * and touches nothing in our database — no transaction row, no ledger entry.
 *
 * Blocked in production: these endpoints are unauthenticated, and against live
 * credentials they would create real QRIS transactions upstream that our system
 * has no record of. Delete this controller, or put it behind the real auth
 * guards, once the purchase flow supersedes it.
 */
@ApiTags('Upstream · MotionPay (manual test)')
@Controller('upstream/motionpay')
export class MotionPayController {
  private readonly logger = new Logger(MotionPayController.name);
  constructor(
    private readonly motionPayService: MotionPayQRISService,
    private readonly motionPayAuthService: MotionPayAuthService,
    private readonly appConfig: AppConfig,
  ) {}

  @Post('qris')
  @ApiOperation({
    summary: 'Create a dynamic QRIS payment (raw wire contract)',
    description:
      "Takes MotionPay's request body verbatim and returns their response " +
      'verbatim — no mapping in either direction, so what you send is exactly ' +
      'what they receive. Persists nothing. Paste their documented example ' +
      'straight in.\n\n' +
      'Note: the body is validated against `MotionPayCreateQrisRequestSchema`, ' +
      'which sets `additionalProperties: false`, and the Ajv pipe is configured ' +
      'with `removeAdditional: true` — so any field not in that schema is ' +
      '**silently dropped** rather than rejected. To trial an undocumented ' +
      'field, loosen the schema first or it will never reach MotionPay.',
  })
  @ApiBody({
    schema: MotionPayCreateQrisRequestSchema as Record<string, any>,
    examples: {
      documented: {
        summary: "MotionPay's documented example",
        value: {
          terminal_id: 'PRODUCT-01',
          external_id: '2023-02',
          amount: 1000,
          description: 'Description of transaction',
          session_time: 3,
          fullname: 'John Doe',
          email: 'email@email.com',
          phone_number: '081510076749',
        },
      },
    },
  })
  async createQris(
    @Body(
      AjvPipe<MotionPayCreateQrisRequestDto>(MotionPayCreateQrisRequestSchema),
    )
    body: MotionPayCreateQrisRequestDto,
  ) {
    this.assertNotProduction();

    return this.surfaceUpstreamErrors(() =>
      this.motionPayService.createQrisPaymentRaw(body),
    );
  }

  @Get('qris/:transactionId')
  @ApiOperation({
    summary: 'Get QRIS payment status',
    description:
      'Looks up by MotionPay `transaction_id` (the `FM-…` value from create), ' +
      'not by our own code — MotionPay documents no lookup by external_id.',
  })
  @ApiParam({
    name: 'transactionId',
    example: 'FM-6b8eb98488dc52e299d53479384',
    description: 'MotionPay transaction_id returned by the create call.',
  })
  async getQrisStatus(@Param('transactionId') transactionId: string) {
    this.assertNotProduction();

    return this.surfaceUpstreamErrors(() =>
      this.motionPayService.getQrisStatus(transactionId),
    );
  }

  @Get('token')
  @ApiOperation({
    summary: 'Verify MotionPay credentials',
    description:
      'Fetches a token to confirm MOTIONPAY_CLIENT_KEY / MOTIONPAY_SERVER_KEY ' +
      'and the base URL are correct. Returns only the decoded expiry, never ' +
      'the token itself — it is a bearer credential.',
  })
  async checkToken() {
    this.assertNotProduction();

    return this.surfaceUpstreamErrors(async () => {
      const token = await this.motionPayAuthService.getToken();
      const expiresAt = this.readExpiry(token);
      return {
        ok: true,
        // Enough to confirm a real JWT came back without disclosing it.
        tokenPreview: `${token.slice(0, 12)}…(${token.length} chars)`,
        expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
        note: expiresAt
          ? undefined
          : 'No readable `exp` claim — the token will not be cached.',
      };
    });
  }

  /**
   * Turn `UpstreamException` into a real HTTP response.
   *
   * Without this it surfaces as a bare 500 and the provider's own error message
   * — the thing you actually need while integrating — stays buried in the logs.
   */
  private async surfaceUpstreamErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof UpstreamException) {
        // Structured, and safe to log: UpstreamException carries the provider's
        // response, never our request headers, so no credential rides along.
        this.logger.error({
          msg: 'MotionPay call failed',
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
        `${ProviderNameEnum.MOTIONPAY} manual test endpoints are disabled in production`,
      );
    }
  }

  private readExpiry(token: string): number | null {
    try {
      const payloadSegment = token.split('.')[1];
      if (!payloadSegment) return null;

      const payload: unknown = JSON.parse(
        Buffer.from(payloadSegment, 'base64url').toString('utf8'),
      );
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('exp' in payload)
      )
        return null;

      const exp = (payload as { exp: unknown }).exp;
      return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
    } catch {
      return null;
    }
  }
}
