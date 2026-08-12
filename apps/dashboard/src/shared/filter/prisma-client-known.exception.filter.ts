import { Prisma } from '@dashboard/prisma';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ResponseDto, ResponseStatus } from '../response.dto';
import { buildMeta } from './build-meta';

/**
 * Maps Prisma error codes to HTTP responses.
 *
 * Only codes reachable while serving a request are listed - legacy also
 * enumerated the P3xxx (migrate), P4xxx (db pull) and P6xxx (Accelerate)
 * families, none of which a request handler can raise. Anything unmapped falls
 * through to 500 with its code preserved under `error.code`, so an unexpected
 * one is still diagnosable from the response.
 */
const PRISMA_ERROR_MAP: Record<
  string,
  { statusCode: number; message: string }
> = {
  // Connection / engine
  P1000: {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Authentication against the database server failed.',
  },
  P1001: {
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Database server could not be reached.',
  },
  P1002: {
    statusCode: HttpStatus.GATEWAY_TIMEOUT,
    message: 'Database connection timed out.',
  },
  P1008: {
    statusCode: HttpStatus.GATEWAY_TIMEOUT,
    message: 'Database operation timed out.',
  },
  P1010: {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database access denied due to insufficient privileges.',
  },
  P1017: {
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Database server closed the connection.',
  },

  // Query engine
  P2000: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Input value is too long for the target column.',
  },
  P2001: { statusCode: HttpStatus.NOT_FOUND, message: 'Record not found.' },
  P2002: {
    statusCode: HttpStatus.CONFLICT,
    message: 'Unique constraint violation.',
  },
  P2003: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Foreign key constraint violation.',
  },
  P2004: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Database constraint violation.',
  },
  P2005: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Invalid value for field.',
  },
  P2006: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Invalid type for field.',
  },
  P2007: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Data validation error.',
  },
  P2011: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Null constraint violation.',
  },
  P2012: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Missing required value.',
  },
  P2013: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Missing required argument.',
  },
  P2014: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Operation would violate a required relation.',
  },
  P2015: {
    statusCode: HttpStatus.NOT_FOUND,
    message: 'Related record not found.',
  },
  P2017: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Records for the relation are not connected.',
  },
  P2020: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Value out of range for the target column.',
  },
  P2021: {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Table does not exist in the current database.',
  },
  P2022: {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Column does not exist in the current database.',
  },
  P2023: {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Inconsistent column data.',
  },
  P2024: {
    statusCode: HttpStatus.GATEWAY_TIMEOUT,
    message: 'Timed out fetching a connection from the pool.',
  },
  P2025: {
    statusCode: HttpStatus.NOT_FOUND,
    message: 'Required record not found.',
  },
  P2034: {
    statusCode: HttpStatus.CONFLICT,
    message:
      'Transaction failed due to a write conflict or deadlock. Please retry.',
  },
  P2037: {
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Too many database connections opened.',
  },
};

/**
 * Prisma's `meta` carries the useful bits (which model, which unique target)
 * alongside a nested driver error quoting raw SQL and relation names. The latter
 * is noise at best and schema disclosure at worst, so it is logged but not returned.
 */
function safeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta) return undefined;

  const rest = Object.fromEntries(
    Object.entries(meta).filter(([key]) => key !== 'driverAdapterError'),
  );
  return Object.keys(rest).length > 0 ? rest : undefined;
}

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaClientKnownExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { code, meta } = exception;
    const mapped = PRISMA_ERROR_MAP[code] ?? {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected database error occurred.',
    };

    const details = safeMeta(meta as Record<string, unknown> | undefined);

    response.status(mapped.statusCode).json(
      new ResponseDto<null>({
        statusCode: mapped.statusCode,
        status: ResponseStatus.ERROR,
        message: mapped.message,
        error: { code: `PRISMA_${code}`, ...(details ? { details } : {}) },
        meta: buildMeta(request),
      }),
    );
  }
}
