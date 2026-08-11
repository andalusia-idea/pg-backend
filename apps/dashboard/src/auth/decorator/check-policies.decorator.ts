import { SetMetadata } from '@nestjs/common';

export const CHECK_POLICIES_KEY = 'CHECK_POLICIES_KEY';

/**
 * A policy predicate. Typed loosely on purpose: the ability object will be a
 * CASL `AppAbility` once the rules are defined, but pinning that type now would
 * mean shipping a CASL dependency for something nothing evaluates yet.
 */
export type PolicyHandler = (ability: unknown) => boolean;

/**
 * Marks the policies a handler will eventually require.
 *
 * **Nothing enforces this yet.** Authorization today is JWT (`JwtAuthGuard`)
 * plus role gates (`RolesGuard` + `@Roles()`); there is deliberately no
 * `PoliciesGuard` registered. The per-endpoint rules are still being decided,
 * so the decorator exists to mark the call sites - making it a one-line change
 * to fill in a policy, and a grep to find every place that needs one - without
 * implying an enforcement that does not exist.
 *
 * Legacy had the inverse problem: `@CheckPolicies(...)` was written out with
 * real policies and then commented out on nearly every controller, which read
 * as "authorized" at a glance while enforcing nothing.
 *
 * @example
 * // today - marks the intent, enforces nothing
 * @CheckPolicies()
 *
 * // once policies land
 * @CheckPolicies((ability: AppAbility) => ability.can('read', 'AgentDetail'))
 */
export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);
