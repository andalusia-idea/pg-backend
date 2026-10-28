import { isValidIpAllowlistEntry } from '@app/microservice';
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Rejects an allowlist entry that is not a bare IP address or CIDR range.
 *
 * Validating here rather than trusting the input matters because a malformed
 * entry is skipped at verification time - it would silently narrow the
 * merchant's allowlist and lock out traffic they believed they had permitted.
 * Same predicate both sides, so what saves is exactly what matches.
 */
export function IsIpAllowlistEntry(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsIpAllowlistEntry',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: {
        validate: (value: unknown): boolean =>
          typeof value === 'string' && isValidIpAllowlistEntry(value),
        defaultMessage: (args?: ValidationArguments): string =>
          `${String(args?.value)} is not a valid IP address or CIDR range`,
      },
    });
  };
}
