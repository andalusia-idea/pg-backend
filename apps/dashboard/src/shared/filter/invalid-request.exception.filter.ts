import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Request, Response } from 'express';
import { InvalidRequestException } from '../exception';
import { buildMeta } from './build-meta';

@Catch(InvalidRequestException)
export class InvalidRequestExceptionFilter implements ExceptionFilter {
  catch(exception: InvalidRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const responseDto = exception.getResponseDto();
    responseDto.meta = buildMeta(request, responseDto.meta);

    return response.status(responseDto.statusCode).json(responseDto);
  }
}
