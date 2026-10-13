import { ClsServiceManager } from 'nestjs-cls';

/**
 * The CLS key every app agrees the acting user lives under.
 *
 * Shared because it is a contract between code that does not know about each
 * other: whatever puts a principal into CLS - `MerchantSignatureGuard`,
 * `JwtAuthGuard`, `ProviderPrincipalInterceptor`, a cron's `cls.run()` wrapper -
 * and each app's Prisma audit extension, which reads it back out to stamp
 * `createdBy`/`updatedBy`.
 *
 * Two keys that were meant to be one is not a hypothetical failure here. It
 * already happened: `MerchantSignatureGuard` wrote the merchant's `userId`
 * under `merchantUserId` while the extension looked for this path, so every row
 * the merchant API wrote was attributed to nobody - silently, because the audit
 * columns are nullable. One literal in one place is the fix for the class, not
 * just that instance.
 *
 * It lives in `@app/microservice` beside `MACHINE_USER_ID`, `SYSTEM_USER_ID`
 * and `PROVIDER_CALLBACK_USER_ID`, which answer "*which* principal"; this
 * answers "where do we put it". Being a mapped `@app/*` path also means specs
 * can import it - the per-app copies this replaced could not be imported from a
 * test, because they sat next to an extension that pulls in a generated Prisma
 * client, and jest maps only the libs.
 *
 * The audit **extensions** stay per app, deliberately. Each one closes over its
 * own generated `Prisma` namespace and its own `AUDITED_MODELS`, so sharing the
 * extension itself would mean a lib importing four app-specific clients.
 */
export const AUDIT_USER_ID_PATH = 'authInfo.userId';

/**
 * The principal the current request or job is acting as, or `undefined`.
 *
 * The audit extensions use this for top-level writes. Call it directly when
 * building a **nested** create - `data: { feeDetails: { create: [...] } }` -
 * because an extension only merges into the top level: it sees one operation on
 * the parent model and never walks into the relation payload. Measured, not
 * assumed: with a principal in CLS the parent row came back `createdBy: 2`
 * while its nested `PurchaseFeeDetail` rows came back `createdBy: null`, even
 * though that model is in `AUDITED_MODELS` and so looks covered.
 *
 * Note the asymmetry with `ClsService.set`, which throws outside an active
 * context. `get` does not - it returns undefined, which is why a cron writing
 * without a `cls.run()` wrapper produced null audit columns rather than an
 * error. So this needs no `isActive()` guard, and callers get a row they can
 * see is unattributed instead of a failed write.
 *
 * Anything that is not a positive integer is rejected. These are `auth.User.id`
 * values, so a bad one is a bug upstream, and `undefined` leaves a visibly
 * empty column rather than a foreign key pointing at nothing.
 */
export function getAuditUserId(): number | undefined {
  const value = ClsServiceManager.getClsService().get(AUDIT_USER_ID_PATH);

  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
