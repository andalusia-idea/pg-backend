import { HttpStatus } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationDto } from './pagination/pagination';

export enum ResponseStatus {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR',
  PARTIAL_SUCCESS = 'PARTIAL_SUCCESS',
}

const STATUS_DEFAULTS: Record<
  ResponseStatus,
  { statusCode: number; message: string }
> = {
  [ResponseStatus.CREATED]: {
    statusCode: HttpStatus.CREATED,
    message: 'Created',
  },
  [ResponseStatus.UPDATED]: { statusCode: HttpStatus.OK, message: 'Updated' },
  [ResponseStatus.SUCCESS]: {
    statusCode: HttpStatus.OK,
    message: 'Request Successfully',
  },
  [ResponseStatus.ERROR]: {
    statusCode: HttpStatus.BAD_REQUEST,
    message: 'Error',
  },
  [ResponseStatus.PARTIAL_SUCCESS]: {
    statusCode: HttpStatus.OK,
    message: 'There is some error',
  },
};

export class ResponseDto<T> {
  constructor({
    statusCode,
    status,
    message,
    data,
    pagination,
    meta,
    error,
  }: {
    statusCode?: number | null;
    status: ResponseStatus;
    message?: string;
    data?: T | null;
    pagination?: PaginationDto | null;
    meta?: unknown;
    error?: Record<string, unknown> | null;
  }) {
    const defaults =
      STATUS_DEFAULTS[status] ?? STATUS_DEFAULTS[ResponseStatus.SUCCESS];

    this.statusCode = statusCode ?? defaults.statusCode;
    this.status = status ?? ResponseStatus.SUCCESS;
    this.message = message ?? defaults.message;
    this.data = data;
    this.pagination = pagination;
    this.meta = meta;
    this.error = error;
  }

  @ApiProperty()
  statusCode: number;

  @ApiProperty({ enum: ResponseStatus })
  status: ResponseStatus;

  @ApiProperty()
  message: string;

  @ApiProperty({ required: false })
  data?: T | null;

  @ApiProperty({ required: false, type: PaginationDto })
  pagination?: PaginationDto | null;

  @ApiProperty({ required: false })
  meta: unknown;

  @ApiProperty({ required: false })
  error?: Record<string, unknown> | null;
}
