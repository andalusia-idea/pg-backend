import { UserRoleEnum } from '@app/microservice';

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

/**
 * Which detail table holds a role's profile row.
 *
 * `ROLE` is the fine-grained name stored in `auth.Role`; `UserRoleEnum` is the
 * coarse profile category. Several admin roles share one AdminDetail table, so
 * the mapping is many-to-one.
 *
 * Legacy resolved this by substring-matching the role name (`includes('admin')`
 * tested before `'merchant'`). That produces the right answer for today's roles
 * only because of the check order - a future MERCHANT_ADMIN would silently
 * resolve to the admin table. Stated explicitly instead.
 *
 * SYSTEM and SCHEDULER are absent on purpose: they have no profile row and
 * cannot sign in to the dashboard.
 */
export const PROFILE_KIND_BY_ROLE = {
  [ROLE.ADMIN_SUPER]: UserRoleEnum.ADMIN,
  [ROLE.ADMIN_ROLE_PERMISSION]: UserRoleEnum.ADMIN,
  [ROLE.ADMIN_AGENT]: UserRoleEnum.ADMIN,
  [ROLE.ADMIN_MERCHANT]: UserRoleEnum.ADMIN,
  [ROLE.AGENT]: UserRoleEnum.AGENT,
  [ROLE.MERCHANT]: UserRoleEnum.MERCHANT,
} as const satisfies Partial<Record<ROLE, UserRoleEnum>>;

/** Roles permitted to administer merchants. */
export const MERCHANT_ADMIN_ROLES: ROLE[] = [
  ROLE.ADMIN_SUPER,
  ROLE.ADMIN_MERCHANT,
];

/** Roles permitted to administer agents. */
export const AGENT_ADMIN_ROLES: ROLE[] = [ROLE.ADMIN_SUPER, ROLE.ADMIN_AGENT];
