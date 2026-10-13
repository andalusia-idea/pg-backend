/**
 * The CLS key the audit extension reads the acting user from.
 *
 * In its own file rather than beside the extension, because the extension
 * imports `@auth/prisma` and jest only maps the `@app/*` libs - anything pulling
 * the extension in transitively fails to resolve the generated client. A
 * constant should not drag a Prisma client behind it.
 *
 * Shared so that a job opening its own context writes the key this reads.
 * Duplicating the literal is how the two drift.
 */
export const AUDIT_USER_ID_PATH = 'authInfo.userId';
