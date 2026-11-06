import type { Prisma } from '@dashboard/prisma';

/**
 * The constructor-parameter type for a DTO built straight from a Prisma row.
 *
 * `Derived` names fields the constructor computes rather than reads. `Raw`
 * names the fields Prisma hands over as a `Decimal` or a `Date` while the DTO
 * declares them `string`, because a string is what crosses the API boundary -
 * money, percentages and timestamps. `@ToMoneyString()`,
 * `@ToPercentageString()` and `@ToJakartaISO()` already accept the raw value
 * and convert it on serialization.
 *
 * Naming them here is what stops a caller pre-stringifying, which is the step
 * that loses precision: `.toFixed(2)` on a `Decimal(8, 4)` percentage rounds
 * 0.7250 to 0.73 before the transform ever runs. It also retires the `as never`
 * casts that used to bridge the mismatch, each of which switched off checking
 * for every other field at the same time.
 */
export type PrismaRowOf<
  T,
  Derived extends keyof T = never,
  Raw extends keyof T = never,
> = Omit<T, Derived | Raw> & {
  [Field in Raw]: T[Field] | Prisma.Decimal | Date;
};

export class DtoHelper {
  /**
   * Copies only the keys declared on the DTO, so a raw Prisma row can be handed
   * straight to a DTO constructor without leaking unmapped columns into the response.
   *
   * Relies on declared class fields existing on the instance, which they do under
   * `useDefineForClassFields` (implied by the repo's ES2023 target).
   */
  static assign(target: object, source: object): void {
    // `target` is typed as plain `object` rather than a generic tied to the
    // source: callers pass `this` from a DTO constructor, and a generic would
    // resolve to the polymorphic `this` type, which no concrete DTO satisfies.
    // The real type check happens at the constructor's own `data:` parameter.
    const targetRecord = target as Record<string, unknown>;
    const sourceRecord = source as Record<string, unknown>;

    for (const key of Object.keys(targetRecord)) {
      if (key in sourceRecord) {
        targetRecord[key] = sourceRecord[key];
      }
    }
  }

  /** Drops null/undefined entries - used to build partial Prisma update payloads. */
  static filter<T extends object>(dto: T): Partial<T> {
    return Object.fromEntries(
      Object.entries(dto).filter(
        ([, value]) => value !== null && value !== undefined,
      ),
    ) as Partial<T>;
  }
}
