/**
 * Step 03 - agents.
 *
 * Before merchants, because an agent is who a merchant is registered under and
 * who takes a share of its fees in step 05.
 *
 * ## What to inject
 *
 * **`agentRegister(superAdmin, agent)`** for each of `AGENTS` in
 * `src/helper/constant.ts`.
 *
 * **As `superAdmin`, not `agentinternal`.** `register-agent` is
 * `SUPER_ADMIN`-only; `MERCHANT_REGISTRAR_ROLES` covers the merchant route but
 * not this one, and `RolesGuard` is live on that controller, so the wrong
 * principal gets a 403 rather than being waved through.
 *
 * ## Ids
 *
 * `register-agent` answers 201 with a null body, so it does not tell you the
 * id. `config.Agent` reuses the `auth.User` id as its own primary key - the
 * same thing `registerMerchant` does at runtime - so the way to learn one is
 * `login(email, AGENT_PASSWORD)` and read `authInfo.userId`. Step 05 needs
 * those ids for `AgentShareholder.agentId`.
 *
 * `agentinternal` is **not** registered here: its `config.Agent` row is engine
 * data, pinned at id 22 by `20261105170000_named_principals`, and it signs in
 * with the provisioning password from the environment. Step 05 may still use
 * its id as a shareholder.
 *
 * ## Not idempotent, unlike the rest
 *
 * A second run against the same database fails on the duplicate email. That is
 * the one step here that needs a reset rather than tolerating a re-run, because
 * registration creates rather than upserts.
 */

describe('inject agent onboard', () => {
  it.todo('register');
});
