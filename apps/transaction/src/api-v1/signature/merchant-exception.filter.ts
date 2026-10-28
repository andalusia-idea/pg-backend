import { MerchantException } from '@app/microservice';
import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { FastifyReply } from 'fastify';

/**
 * Renders {@link MerchantException} as the SNAP-shaped envelope.
 *
 * Scoped to that one exception type deliberately. Registered globally but
 * catching everything, it would also reshape errors from the health
 * endpoints, Swagger and the MotionPay test controllers - none of which are
 * merchant-facing and none of which should speak this envelope.
 */
@Catch(MerchantException)
export class MerchantExceptionFilter implements ExceptionFilter<MerchantException> {
  private readonly logger = new Logger(MerchantExceptionFilter.name);

  catch(exception: MerchantException, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const reply = context.getResponse<FastifyReply>();

    // Debug, not warn: a rejected signature is the system working as designed.
    // Volume here is attacker-controllable, so anything louder becomes noise
    // that buries real problems. The 503 path logs at error level in the guard,
    // where the cause is known.
    this.logger.debug({
      msg: 'Merchant API request rejected',
      responseCode: exception.response.responseCode,
      url: context.getRequest<{ url?: string }>().url,
    });

    // Standard header, and the only machine-readable way to tell a client when
    // to come back. Without it a naive retry loop turns a throttle into an
    // outage for the merchant.
    if (exception.retryAfterSeconds !== null) {
      void reply.header('Retry-After', String(exception.retryAfterSeconds));
    }

    void reply.status(exception.httpStatus).send(exception.response);
  }
}
