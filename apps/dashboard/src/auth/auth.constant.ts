/**
 * Roles as stored in the `auth.Role` table. Modelled as a const object rather
 * than a TS enum so the derived type is a plain string-literal union - values
 * arriving as JSON (JWT claims, request bodies) are structurally compatible
 * with no cast, and Swagger/class-validator both accept the object form.
 */
export const ROLE = {
  SYSTEM: 'SYSTEM',
  SCHEDULER: 'SCHEDULER',
  ADMIN_SUPER: 'ADMIN_SUPER',
  ADMIN_ROLE_PERMISSION: 'ADMIN_ROLE_PERMISSION',
  ADMIN_AGENT: 'ADMIN_AGENT',
  ADMIN_MERCHANT: 'ADMIN_MERCHANT',
  AGENT: 'AGENT',
  MERCHANT: 'MERCHANT',
} as const;
export type ROLE = (typeof ROLE)[keyof typeof ROLE];

/** Key under which the authenticated principal is stored in CLS. */
export const CLS_AUTH_INFO_KEY = 'authInfo';
