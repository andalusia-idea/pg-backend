import { ROLE } from '@app/microservice';

/**
 * `ROLE` and `PROFILE_KIND_BY_ROLE` moved to `@app/microservice` - every app
 * reasons about roles, so they belong with the other shared domain enums.
 * Re-exported here so existing imports inside this app keep working.
 */
export { ROLE, PROFILE_KIND_BY_ROLE } from '@app/microservice';

/** Key under which the authenticated principal is stored in CLS. */
export const CLS_AUTH_INFO_KEY = 'authInfo';

/**
 * Merchants are onboarded by their agent, never directly by an admin - the
 * internal team is issued an "AgentInternal" agent account and signs in as an
 * agent to do it. That keeps every merchant attached to an agent, which is what
 * the AgentShareholder row in registerMerchant depends on.
 */
export const MERCHANT_REGISTRAR_ROLES: ROLE[] = [ROLE.AGENT];

/** Roles permitted to administer agents. */
export const AGENT_ADMIN_ROLES: ROLE[] = [ROLE.SUPER_ADMIN, ROLE.ADMIN];

/**
 * Roles permitted to write a merchant's commercial terms.
 *
 * Named separately from `AGENT_ADMIN_ROLES` despite listing the same two, so
 * that widening one does not silently widen the other. The exclusions are the
 * point: an AGENT must not set the fees it earns a share of, and a MERCHANT
 * must not set the terms on which we advance it money - a merchant who could
 * put itself on `INSTANT` would be writing itself a credit line.
 *
 * `ConfigMerchantController`'s older routes carry `@CheckPolicies()` alone,
 * which enforces nothing, so they are open to any authenticated role today.
 * That is tracked separately; it is not a reason to leave a new route open.
 */
export const MERCHANT_TERMS_ROLES: ROLE[] = [ROLE.SUPER_ADMIN, ROLE.ADMIN];
