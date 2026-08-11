import { ParseArrayPipe, Type } from '@nestjs/common';
import { validationExceptionFactory } from './custom-validation.pipe';

/**
 * ParseArrayPipe for an array request body, wired to the same error factory as
 * CustomValidationPipe.
 *
 * A bare `new ParseArrayPipe({ items })` builds its own ValidationPipe with
 * default options, so array endpoints answered with a 400 and a prose message
 * while every object endpoint answered with a 422 and a per-field map. Same
 * validation failure, two different response shapes for the frontend to handle.
 */
export function ParseDtoArrayPipe<T>(itemType: Type<T>): ParseArrayPipe {
  // No `transform` option: ParseArrayPipe always instantiates `items` for each
  // element, so class-transformer decorators run regardless.
  return new ParseArrayPipe({
    items: itemType,
    whitelist: true,
    exceptionFactory: validationExceptionFactory,
  });
}
