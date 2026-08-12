import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiErrorCode,
  InvalidRequestException,
  ResponseException,
} from '../exception';
import { ResponseDto, ResponseStatus } from '../response.dto';
import { buildMeta } from './build-meta';

const HTTP_STATUS_TO_ERROR_CODE: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: ApiErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ApiErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ApiErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ApiErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ApiErrorCode.CONFLICT,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ApiErrorCode.VALIDATION_FAILED,
};

/** Lowest-priority catch-all: guarantees every error leaves as a ResponseDto. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const responseDto = this.toResponseDto(exception, request);

    response.status(responseDto.statusCode).json(responseDto);
  }

  private toResponseDto(
    exception: unknown,
    request: Request,
  ): ResponseDto<null> {
    if (
      exception instanceof ResponseException ||
      exception instanceof InvalidRequestException
    ) {
      const responseDto = exception.getResponseDto() as ResponseDto<null>;
      responseDto.meta = buildMeta(request, responseDto.meta);
      return responseDto;
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception, request);
    }

    if (exception instanceof Error) {
      return this.fromGenericError(exception, request);
    }

    return new ResponseDto<null>({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      status: ResponseStatus.ERROR,
      message: 'An unexpected internal error occurred',
      error: { code: ApiErrorCode.INTERNAL_ERROR },
      meta: buildMeta(request),
    });
  }

  private fromHttpException(
    exception: HttpException,
    request: Request,
  ): ResponseDto<null> {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();

    const message = this.extractMessage(response, exception.message);

    const error =
      typeof response === 'object' &&
      response !== null &&
      'error' in response &&
      typeof response.error === 'object' &&
      response.error !== null
        ? { ...(response.error as Record<string, unknown>) }
        : {};

    error.code ??= this.httpErrorCode(statusCode, message);

    return new ResponseDto<null>({
      statusCode,
      status: ResponseStatus.ERROR,
      message,
      error,
      meta: buildMeta(request),
    });
  }

  /**
   * A Nest HttpException body is either a string or an object whose `message`
   * is a string or a string[] (the shape ValidationPipe produces). Only those
   * forms are trusted; anything else falls back to the exception's own message
   * rather than being stringified into something like "[object Object]".
   */
  private extractMessage(response: unknown, fallback: string): string {
    if (typeof response === 'string') return response;

    if (
      typeof response !== 'object' ||
      response === null ||
      !('message' in response)
    ) {
      return fallback;
    }

    const { message } = response as { message: unknown };

    if (typeof message === 'string') return message;
    if (Array.isArray(message) && typeof message[0] === 'string') {
      return message[0];
    }

    return fallback;
  }

  /**
   * The money/date transforms throw plain Errors because class-transformer runs
   * outside the DI-aware pipeline; map them back to their proper 422 codes.
   */
  private fromGenericError(error: Error, request: Request): ResponseDto<null> {
    const invalidDecimal = error.message.startsWith('Invalid decimal value');
    const invalidDate = error.message.startsWith('Invalid date value');

    if (invalidDecimal || invalidDate) {
      return new ResponseDto<null>({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        status: ResponseStatus.ERROR,
        message: invalidDecimal
          ? 'Request contains an invalid decimal value'
          : 'Request contains an invalid date-time value',
        error: {
          code: invalidDecimal
            ? ApiErrorCode.INVALID_DECIMAL
            : ApiErrorCode.INVALID_DATE,
        },
        meta: buildMeta(request),
      });
    }

    return new ResponseDto<null>({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      status: ResponseStatus.ERROR,
      message: 'An unexpected internal error occurred',
      error: { code: ApiErrorCode.INTERNAL_ERROR },
      meta: buildMeta(request),
    });
  }

  private httpErrorCode(statusCode: number, message: string): string {
    if (
      statusCode === (HttpStatus.BAD_REQUEST as number) &&
      message.includes('numeric string is expected')
    ) {
      return ApiErrorCode.INVALID_PATH_PARAMETER;
    }

    // A lookup keyed by the numeric status, since getStatus() returns a plain
    // number rather than an HttpStatus member.
    return HTTP_STATUS_TO_ERROR_CODE[statusCode] ?? 'HTTP_EXCEPTION';
  }
}
