import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Request, Response } from 'express';
import { ResponseException } from '../exception';
import { buildMeta } from './build-meta';

@Catch(ResponseException)
export class ResponseExceptionFilter implements ExceptionFilter {
  catch(exception: ResponseException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const responseDto = exception.getResponseDto();
    responseDto.meta = buildMeta(request, responseDto.meta);

    return response.status(responseDto.statusCode).json(responseDto);
  }
}
