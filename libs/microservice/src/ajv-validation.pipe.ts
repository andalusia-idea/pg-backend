// one reusable pipe, any transport
import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import Ajv, { ValidateFunction, Schema } from 'ajv';

const ajv = new Ajv({
  coerceTypes: true,
  removeAdditional: true,
  allErrors: true,
});
const validatorCache = new Map<Schema, ValidateFunction>();

function compile<T>(schema: Schema): ValidateFunction<T> {
  let fn = validatorCache.get(schema);
  if (!fn) {
    fn = ajv.compile(schema);
    validatorCache.set(schema, fn);
  }
  return fn as ValidateFunction<T>;
}

export function AjvPipe<T>(schema: Schema): PipeTransform {
  const validate = compile<T>(schema);
  @Injectable()
  class _AjvPipe implements PipeTransform {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    transform(value: T, _metadata: ArgumentMetadata): T {
      if (!validate(value)) {
        throw new BadRequestException(validate.errors);
      }
      return value;
    }
  }
  return new _AjvPipe();
}
