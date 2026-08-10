import { UnprocessableEntityException } from '@nestjs/common';
import { ResponseDto } from '../response.dto';

/** Raised by CustomValidationPipe when class-validator rejects a payload. */
export class InvalidRequestException extends UnprocessableEntityException {
  private readonly responseDto: ResponseDto<null>;

  constructor(responseDto: ResponseDto<null>) {
    super(responseDto);
    this.responseDto = responseDto;
  }

  getResponseDto(): ResponseDto<null> {
    return this.responseDto;
  }
}
