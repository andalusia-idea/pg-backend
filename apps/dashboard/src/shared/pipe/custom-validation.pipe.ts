import { Injectable, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ApiError } from '../exception';

/** Collapses nested validation errors into a flat `{ "a.b": "message" }` map. */
function flattenValidationErrors(
  validationErrors: ValidationError[],
  parentPath = '',
): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const validationError of validationErrors) {
    const path = parentPath
      ? `${parentPath}.${validationError.property}`
      : validationError.property;

    const firstConstraint = Object.values(validationError.constraints ?? {})[0];
    if (firstConstraint) fields[path] = firstConstraint;

    if (validationError.children?.length) {
      Object.assign(
        fields,
        flattenValidationErrors(validationError.children, path),
      );
    }
  }

  return fields;
}

@Injectable()
export class CustomValidationPipe extends ValidationPipe {
  constructor() {
    super({
      whitelist: true,
      transform: true,
      exceptionFactory: (validationErrors: ValidationError[]) => {
        throw ApiError.validationFailed(
          flattenValidationErrors(validationErrors),
        );
      },
    });
  }
}
