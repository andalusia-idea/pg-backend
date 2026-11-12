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
 * `login(email, AGENT_PASSWORD)` and read `authInfo.userId`. That is the number
 * `AgentShareholder.agentId` points at.
 *
 * **Not `authInfo.profileId`.** That one is the `auth.AgentDetail` row's id, a
 * different number that looks just as plausible in a payload. Step 2 below
 * pins the distinction.
 *
 * **Step 05 cannot be handed these ids either.** The runner spawns one jest
 * process per step file, so it logs the agents in again itself.
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

import { HttpStatus } from '@nestjs/common';
import { ROLE } from '@app/microservice/microservice.enum';
import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';
import {
  AGENT_PASSWORD,
  AGENTS,
  agentRegister,
  login,
  loginSuperAdmin,
  userProfile,
} from 'apps/uat-local/src/helper';

describe('inject agent onboard', () => {
  let superAdmin: AuthDto;

  beforeAll(async () => {
    superAdmin = await loginSuperAdmin();
    expect(superAdmin.token).toBeTruthy();
    expect(superAdmin.authInfo.userId).toBeGreaterThan(0);
  });

  it('1 register agent', async () => {
    for (const a of AGENTS) {
      const res = await agentRegister(superAdmin, a);
      expect(res.statusCode).toEqual(HttpStatus.CREATED);
      expect(res.status).toBe(ResponseStatus.CREATED);
    }
  });

  it('2 sign in as each agent', async () => {
    // Not a formality. `registerAgent` writes three rows in one transaction -
    // `auth.User`, `auth.AgentDetail` and `config.Agent` - and answers 201 with
    // a null body, so step 1 passing only means the transaction committed. A
    // login proves the user is usable with the fixture's password, and the
    // profile read proves the detail row went with it rather than the account
    // existing with nothing behind it.
    const agentIds = new Set<number>();

    for (const a of AGENTS) {
      const auth = await login(a.email, AGENT_PASSWORD);

      expect(auth.token).toBeTruthy();
      expect(auth.authInfo.role).toEqual(ROLE.AGENT);
      expect(auth.authInfo.userId).toBeGreaterThan(0);
      expect(auth.authInfo.profileId).toBeGreaterThan(0);

      // `userId` is the one step 05 wants: `config.Agent` shares the auth
      // user's id as its primary key, so that is what `AgentShareholder.agentId`
      // points at. `profileId` is the `auth.AgentDetail` row and is a different
      // number - close enough to pass for the other that it is worth naming.
      agentIds.add(auth.authInfo.userId);

      const res = await userProfile(auth);
      expect(res.statusCode).toEqual(HttpStatus.OK);
      expect(res.status).toBe(ResponseStatus.SUCCESS);

      const profile = res.data!;
      expect(profile.userId).toEqual(auth.authInfo.userId);
      expect(profile.profileId).toEqual(auth.authInfo.profileId);
      expect(profile.email).toEqual(a.email);

      // Exactly one of the three is populated, matching the role. An agent
      // whose detail row is missing would answer with all three null.
      expect(profile.agent).not.toBeNull();
      expect(profile.admin).toBeNull();
      expect(profile.merchant).toBeNull();

      expect(profile.agent!.fullname).toEqual(a.fullname);
      expect(profile.agent!.phone).toEqual(a.phone);
      expect(profile.agent!.address).toEqual(a.address);
      expect(profile.agent!.bankName).toEqual(a.bankName);
      expect(profile.agent!.accountNumber).toEqual(a.accountNumber);
      expect(profile.agent!.accountHolderName).toEqual(a.accountHolderName);
    }

    // Four fixtures, four distinct users - not one row that four emails
    // happened to resolve to.
    expect(agentIds.size).toEqual(AGENTS.length);
  });
});
