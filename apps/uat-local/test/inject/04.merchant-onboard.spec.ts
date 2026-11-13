/**
 * Step 04 - merchants.
 *
 * After agents, because a merchant is registered by one. Before 05, which gives
 * these merchants the fee rows they need to transact at all.
 *
 * ## What to inject
 *
 * **`merchantRegister(agentInternal, merchant)`** for each of `MERCHANTS` in
 * `src/helper/constant.ts`.
 *
 * Registered through the **real admin path** rather than reusing the seeded
 * `merchant1@example.com` fixtures, which is possible because the named
 * principals landed: `agentinternal` is `config.Agent` 22 and can sign in.
 * `registerMerchant` writes the `auth.User`, the detail row, the
 * `config.Merchant` row and a default `MerchantSettlementPolicy` in one
 * transaction.
 *
 * ## Ids
 *
 * Same as step 03: the response carries a null body, and `config.Merchant`
 * reuses the `auth.User` id, so `login(email, MERCHANT_PASSWORD)` then
 * `authInfo.userId` is how a later step learns one.
 *
 * Worth asserting `authInfo.profileId === authInfo.userId` once, because
 * `MerchantFee.merchantId` is matched against the **auth user id** by
 * `ProfileProviderService` at transaction time. If those two ever stop being
 * equal, step 05 would write fee rows against an id nothing routes by, and
 * nothing would complain.
 *
 * ## What a merchant still cannot do after this step
 *
 * Transact. Registration gives it no fees, and routing *is* the fee row, so
 * `resolveProvider` answers 403 until step 05 runs. That is deliberate rather
 * than a gap: it is the state every real merchant passes through, and the one
 * merchant left without fees in step 05 is what keeps that path exercised.
 *
 * It also has no signing secret yet - `MerchantSignature` is created with a
 * `clientId` but a null `secretKey`, `payinUrl` and `payoutUrl`. Rotating the
 * secret and registering the webhook URLs is merchant-signature work, not
 * onboarding, and belongs in its own step once the behaviour run needs it.
 *
 * ## Not idempotent
 *
 * As with agents, a second run fails on the duplicate email.
 */

import { ROLE } from '@app/microservice/microservice.enum';
import { HttpStatus } from '@nestjs/common';
import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';
import {
  login,
  loginAgentInternal,
  loginSuperAdmin,
  MERCHANT_PASSWORD,
  merchantRegister,
  MERCHANTS,
  userProfile,
} from 'apps/uat-local/src/helper';

describe('inject merchant onboard', () => {
  let superAdmin: AuthDto;
  let agentInternal: AuthDto;

  beforeAll(async () => {
    superAdmin = await loginSuperAdmin();
    expect(superAdmin.token).toBeTruthy();
    expect(superAdmin.authInfo.userId).toBeGreaterThan(0);
    agentInternal = await loginAgentInternal();
    expect(agentInternal.token).toBeTruthy();
    expect(agentInternal.authInfo.userId).toBeGreaterThan(0);
  });

  it('1. register merchant', async () => {
    for (const m of MERCHANTS) {
      const res = await merchantRegister(agentInternal, m);
      expect(res.statusCode).toEqual(HttpStatus.CREATED);
      expect(res.status).toBe(ResponseStatus.CREATED);
    }
  });

  it('2. sign in each merchant', async () => {
    const merchantIds = new Set<number>();
    for (const m of MERCHANTS) {
      const auth = await login(m.email, MERCHANT_PASSWORD);

      expect(auth.token).toBeTruthy();
      expect(auth.authInfo.role).toEqual(ROLE.MERCHANT);
      expect(auth.authInfo.userId).toBeGreaterThan(0);
      expect(auth.authInfo.profileId).toBeGreaterThan(0);

      merchantIds.add(auth.authInfo.userId);

      const res = await userProfile(auth);
      expect(res.statusCode).toEqual(HttpStatus.OK);
      expect(res.status).toBe(ResponseStatus.SUCCESS);

      expect(res.data).toBeTruthy();
      const profile = res.data!;
      expect(profile.userId).toEqual(auth.authInfo.userId);
      expect(profile.profileId).toEqual(auth.authInfo.profileId);
      expect(profile.email).toEqual(m.email);

      expect(profile.admin).toBeNull();
      expect(profile.merchant).not.toBeNull();
      expect(profile.agent).toBeNull();

      const merchant = profile.merchant!;
      expect(merchant.bankCode).toEqual(m.bankCode);
      expect(merchant.bankName).toEqual(m.bankName);
      expect(merchant.accountNumber).toEqual(m.accountNumber);
      expect(merchant.accountHolderName).toEqual(m.accountHolderName);
      expect(merchant.address).toEqual(m.address);
      expect(merchant.npwp).toEqual(m.npwp);
      expect(merchant.businessName).toEqual(m.businessName);
    }
    expect(merchantIds.size).toEqual(MERCHANTS.length);
  });

  it('3. merchant signature', async () => {});
});
