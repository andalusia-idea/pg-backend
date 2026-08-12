import { ResponseDto, ResponseStatus } from '../response.dto';

type ResponseExceptionInput = {
  statusCode: number;
  message: string;
  code?: string | null;
  details?: Record<string, unknown> | null;
  fields?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
};

/**
 * Carries a fully-formed ResponseDto so the matching filter can emit it verbatim,
 * keeping error payloads shaped exactly like success payloads.
 */
export class ResponseException extends Error {
  private readonly responseDto: ResponseDto<unknown>;

  constructor(responseDto: ResponseDto<unknown>) {
    super();
    this.responseDto = responseDto;
  }

  getResponseDto(): ResponseDto<unknown> {
    return this.responseDto;
  }

  static from({
    statusCode,
    message,
    code,
    details,
    fields,
    meta,
  }: ResponseExceptionInput): ResponseException {
    const errorPayload: Record<string, unknown> = {};

    if (code) errorPayload.code = code;
    if (details && Object.keys(details).length > 0) {
      errorPayload.details = details;
    }
    if (fields && Object.keys(fields).length > 0) {
      errorPayload.fields = fields;
    }

    return new ResponseException(
      new ResponseDto({
        statusCode,
        status: ResponseStatus.ERROR,
        message,
        error: Object.keys(errorPayload).length > 0 ? errorPayload : null,
        meta: meta ?? undefined,
      }),
    );
  }
}
