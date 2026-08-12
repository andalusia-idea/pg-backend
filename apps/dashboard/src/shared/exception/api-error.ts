import { HttpStatus } from '@nestjs/common';
import { ResponseDto, ResponseStatus } from '../response.dto';
import { InvalidRequestException } from './invalid-request.exception';
import { ResponseException } from './response.exception';

type ApiErrorInput = {
  statusCode: number;
  message: string;
  code: string;
  details?: Record<string, unknown> | null;
  fields?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
};

export const ApiErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_PATH_PARAMETER: 'INVALID_PATH_PARAMETER',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_DECIMAL: 'INVALID_DECIMAL',
  INVALID_DATE: 'INVALID_DATE',
  DATE_RANGE_INVALID: 'DATE_RANGE_INVALID',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/**
 * Factory for every error this app raises. Keeping construction in one place means
 * error payloads stay uniform and each `code` is greppable.
 *
 * Trimmed relative to the legacy services: the dependency-failure helpers there
 * existed for inter-service TCP calls, which the dashboard does not make.
 */
export class ApiError {
  static response({
    statusCode,
    message,
    code,
    details,
    fields,
    meta,
  }: ApiErrorInput): ResponseException {
    return ResponseException.from({
      statusCode,
      message,
      code,
      details: details ?? null,
      fields: fields ?? null,
      meta: meta ?? null,
    });
  }

  static invalidRequest({
    statusCode,
    message,
    code,
    details,
    fields,
    meta,
  }: ApiErrorInput): InvalidRequestException {
    return new InvalidRequestException(
      new ResponseDto<null>({
        statusCode,
        status: ResponseStatus.ERROR,
        message,
        error: {
          code,
          ...(details ? { details } : {}),
          ...(fields ? { fields } : {}),
        },
        meta: meta ?? undefined,
      }),
    );
  }

  static unauthorized(message = 'Unauthorized'): ResponseException {
    return this.response({
      statusCode: HttpStatus.UNAUTHORIZED,
      message,
      code: ApiErrorCode.UNAUTHORIZED,
    });
  }

  static forbidden(message = 'Forbidden'): ResponseException {
    return this.response({
      statusCode: HttpStatus.FORBIDDEN,
      message,
      code: ApiErrorCode.FORBIDDEN,
    });
  }

  static notFound(subject: string): ResponseException {
    return this.response({
      statusCode: HttpStatus.NOT_FOUND,
      message: `${subject} not found`,
      code: ApiErrorCode.NOT_FOUND,
    });
  }

  static conflict(message: string): ResponseException {
    return this.response({
      statusCode: HttpStatus.CONFLICT,
      message,
      code: ApiErrorCode.CONFLICT,
    });
  }

  static badRequest(
    message: string,
    fields?: Record<string, unknown>,
  ): ResponseException {
    return this.response({
      statusCode: HttpStatus.BAD_REQUEST,
      message,
      code: ApiErrorCode.BAD_REQUEST,
      fields: fields ?? null,
    });
  }

  static invalidPathParameter(
    field: string,
    reason = 'Expected an integer value',
  ): ResponseException {
    return this.response({
      statusCode: HttpStatus.BAD_REQUEST,
      message: `Invalid path parameter '${field}'`,
      code: ApiErrorCode.INVALID_PATH_PARAMETER,
      fields: { [field]: reason },
    });
  }

  static validationFailed(
    fields: Record<string, string>,
  ): InvalidRequestException {
    return this.invalidRequest({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: 'Request validation failed',
      code: ApiErrorCode.VALIDATION_FAILED,
      fields,
    });
  }

  static invalidDecimal(field: string, value: unknown): ResponseException {
    return this.response({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: `Field '${field}' must be a valid decimal value`,
      code: ApiErrorCode.INVALID_DECIMAL,
      fields: { [field]: `Invalid decimal value: ${String(value)}` },
    });
  }

  static invalidDate(field: string, value: unknown): ResponseException {
    return this.response({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: `Field '${field}' must be a valid date-time`,
      code: ApiErrorCode.INVALID_DATE,
      fields: { [field]: `Invalid date value: ${String(value)}` },
    });
  }

  static dateRangeInvalid(): ResponseException {
    return this.response({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: `'from' must be earlier than or equal to 'to'`,
      code: ApiErrorCode.DATE_RANGE_INVALID,
      fields: { from: `'from' must be earlier than or equal to 'to'` },
    });
  }
}
