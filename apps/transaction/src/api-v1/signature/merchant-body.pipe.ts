import { TransactionException } from '@app/microservice';
import { Injectable, PipeTransform } from '@nestjs/common';
import Ajv, { ErrorObject, Schema, ValidateFunction } from 'ajv';

/**
 * AJV configured for merchant request bodies.
 *
 * - `removeAdditional: true` - a field we do not know about is dropped rather
 *   than rejected. Merchants add fields to their payloads (their own tracking
 *   ids, provider hints copied from other integrations) and failing those
 *   requests creates support load for nothing. What we ignore cannot hurt us.
 * - `coerceTypes: false` - `"10000"` where the schema says number is a contract
 *   disagreement worth surfacing, and coercion on a money field is exactly how
 *   a wrong amount gets accepted quietly.
 * - `allErrors: true` - so the merchant can fix every problem in one round trip
 *   rather than discovering them one at a time.
 */
const ajv = new Ajv({
  removeAdditional: true,
  coerceTypes: false,
  allErrors: true,
});

const validatorCache = new Map<Schema, ValidateFunction>();

function compile<T>(schema: Schema): ValidateFunction<T> {
  let validate = validatorCache.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    validatorCache.set(schema, validate);
  }
  return validate as ValidateFunction<T>;
}

/**
 * Render AJV errors as one short, merchant-readable line.
 *
 * `instancePath` is JSON-Pointer (`/amount/value`); merchants think in field
 * names, so the leading slash goes and the rest reads as a path. Capped
 * deliberately - `responseMessage` is limited to 150 characters, and the point
 * is to name the field, not to reproduce the schema.
 */
function describe(errors: ErrorObject[] = []): string {
  return errors
    .slice(0, 3)
    .map((error) => {
      const field =
        error.keyword === 'required'
          ? String(
              (error.params as { missingProperty?: string }).missingProperty ??
                '',
            )
          : error.instancePath.replace(/^\//, '').replace(/\//g, '.');
      return field ? `${field} ${error.message}` : (error.message ?? 'invalid');
    })
    .join('; ');
}

/**
 * Validates a merchant request body, failing in the SNAP envelope.
 *
 * This exists because the shared `AjvPipe` throws `BadRequestException`, which
 * `MerchantExceptionFilter` does not catch - so a malformed body would come
 * back in Nest's default error shape while every other failure on the same
 * endpoint speaks the SNAP envelope. One endpoint answering in two different
 * formats is precisely the thing the envelope exists to prevent.
 *
 * A missing field and a malformed field are reported as different codes because
 * they are different mistakes: one means the merchant did not send something,
 * the other means they sent it wrong.
 */
export function MerchantBodyPipe<T>(schema: Schema): PipeTransform {
  const validate = compile<T>(schema);

  @Injectable()
  class _MerchantBodyPipe implements PipeTransform {
    transform(value: T): T {
      // A body-less POST arrives as undefined, which AJV would report as a type
      // error rather than the missing-payload problem it actually is.
      if (value === undefined || value === null) {
        throw TransactionException.invalidMandatoryField('request body');
      }

      if (!validate(value)) {
        const errors = validate.errors ?? [];
        const missing = errors.some((error) => error.keyword === 'required');
        const detail = describe(errors);

        throw missing
          ? TransactionException.invalidMandatoryField(detail)
          : TransactionException.invalidFieldFormat(detail);
      }

      return value;
    }
  }

  return new _MerchantBodyPipe();
}
