import { MERCHANT_SERVICE_CODE, MerchantResponseDto } from '@app/microservice';
import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

const SUCCESS_CODE_KEY = 'merchant-success-code';

/**
 * Override the success `responseCode` for one handler.
 *
 * Cross-cutting endpoints (the credential check) keep the default `00`
 * service code. Business endpoints that need their own take a code from the
 * manapay registry - `90`+, chosen to sit outside SNAP's 01-81 range so the
 * two can never be confused. See {@link MERCHANT_SERVICE_CODE}.
 *
 * @example `@MerchantSuccessCode('90', '00')` -> responseCode `2009000`
 */
export const MerchantSuccessCode = (serviceCode: string, caseCode = '00') =>
  SetMetadata(SUCCESS_CODE_KEY, { serviceCode, caseCode });

/** What a merchant receives from any successful call. */
export interface MerchantSuccessEnvelope<T> extends MerchantResponseDto {
  serverTime: string;
  data: T;
}

/**
 * Wraps handler return values in the SNAP-shaped success envelope, so every
 * merchant-facing response - success or failure - has the same two fields at
 * the top.
 *
 * The payload sits under `data` rather than being spread alongside
 * `responseCode`. SNAP itself uses a per-service field name
 * (`virtualAccountData`, `accountInfos`), which would mean naming a field for
 * every endpoint and risks a business field one day colliding with
 * `responseCode`. A fixed `data` key is the deliberate simplification: one
 * shape to parse, for every endpoint, forever.
 *
 * `serverTime` is present on success as well as failure so a merchant can
 * check their clock against ours at any time, not only after being rejected.
 */
@Injectable()
export class MerchantResponseInterceptor<T> implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<MerchantSuccessEnvelope<T>> {
    // Non-HTTP contexts (TCP message handlers) must pass through untouched -
    // wrapping an internal RPC reply in a merchant envelope would break every
    // caller that expects the raw DTO.
    if (context.getType() !== 'http')
      return next.handle() as Observable<MerchantSuccessEnvelope<T>>;

    const override = this.reflector.getAllAndOverride<{
      serviceCode: string;
      caseCode: string;
    }>(SUCCESS_CODE_KEY, [context.getHandler(), context.getClass()]);

    const serviceCode = override?.serviceCode ?? MERCHANT_SERVICE_CODE.COMMON;
    const caseCode = override?.caseCode ?? '00';

    return next.handle().pipe(
      map((data: T) => {
        return {
          responseCode: `${HttpStatus.OK}${serviceCode}${caseCode}`,
          responseMessage: 'Successful',
          serverTime: new Date().toISOString(),
          data: data ?? null,
        } as MerchantSuccessEnvelope<T>;
      }),
    );
  }
}
