import Ajv, { Schema, ValidateFunction } from 'ajv';
import { UpstreamException } from './upstream.exception';
import { ProviderNameEnum } from '@app/microservice';

/**
 * Validator for responses coming *in* from an upstream provider.
 *
 * Deliberately configured differently from the inbound `AjvPipe` in
 * `libs/microservice`:
 *
 * - `removeAdditional: false` — we keep every field the provider sent, because
 *   the full raw payload gets persisted as transaction metadata. Stripping
 *   unknown fields would silently discard evidence we may need to reconcile a
 *   disputed payment.
 * - `coerceTypes: false` — a provider returning `"1100"` where the contract
 *   says `1100` is a contract drift we want to see, not paper over. Coercion on
 *   money fields is exactly how a wrong amount slips through.
 */
const ajv = new Ajv({
  removeAdditional: false,
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
 * Assert an upstream response matches `schema`, returning it typed.
 *
 * Throws `UpstreamException` rather than `BadRequestException`: a malformed
 * provider response is an upstream fault, not a caller fault, and must not be
 * reported to our own API consumers as a 400.
 */
export function assertUpstreamSchema<T>(
  context: string,
  provider: ProviderNameEnum,
  schema: Schema,
  value: unknown,
): T {
  const validate = compile<T>(schema);
  if (!validate(value)) {
    throw new UpstreamException(
      provider,
      `${context}: response did not match the expected schema`,
      { errors: validate.errors, response: value },
    );
  }
  return value as T;
}
