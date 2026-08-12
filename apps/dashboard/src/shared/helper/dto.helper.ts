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
