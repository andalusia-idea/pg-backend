/**
 * Step 05 - per-merchant fee config, and who shares the agent's cut.
 *
 * Last, because it needs base-fee ids from 02, merchant ids from 04 and agent
 * ids from 03. **This is the step that makes a merchant able to transact.**
 *
 * ## What to inject
 *
 * 1. **`merchantFeeUpsert(admin, merchantId, fees)`** per merchant, each entry
 *    `{ action: 'I', baseFeeId, feeInternalFixed, feeInternalPercentage,
 *    feeAgentFixed, feeAgentPercentage }`.
 *
 *    An ADMIN registered in step 1 is the principal, because an operator
 *    entering a merchant's commercial terms is what this endpoint is for.
 *    Nothing enforces that yet: `ConfigMerchantController` carries only
 *    `@CheckPolicies()`, still a placeholder, and no `@Roles` - so any
 *    authenticated token would be accepted. Using the right one anyway means
 *    the step keeps working on the day the guard arrives.
 *
 *    **Routing is this row, not a provider setting.** `ProfileProviderService`
 *    resolves a merchant's provider through `merchantFee.baseFee`, filtering on
 *    the base fee's `paymentMethodName`, `transactionType` and `isActive` - and
 *    deliberately *not* on provider, with **no `orderBy`**. So two rows for one
 *    (method, type) pairing make the chosen provider depend on Postgres row
 *    order. Give each merchant at most one row per pairing, and put a second
 *    provider on a *different merchant* rather than as a second row on the same
 *    one.
 *
 *    That is also how to make a merchant route to a particular upstream: there
 *    is no switch for it, only which base fee its own row points at.
 *
 * 2. **`merchantAgentShareholderUpsert(agentInternal, merchantId, holders)`**
 *    for any merchant given a non-zero agent fee.
 *
 *    An agent fee with no shareholder row is money owed to nobody - the fee
 *    says an agent is due a cut and no row says which one.
 *    `assertShareholderPercentagesTotal` sums the **request**, not the stored
 *    set, so a batch has to total exactly 100 even when it is a partial update.
 *
 * ## The shape this installs
 *
 * All four merchants get a row on every rail 01 and 02 installed - seven each,
 * from `MATRIX_MERCHANT_FEE` - so every merchant can transact, which is what
 * makes them useful for imitating behaviour. They differ in the agent cut:
 *
 * | Merchant | Agent fee | Shareholders |
 * |---|---|---|
 * | merchant1 | yes | agent1 at 100% |
 * | merchant2 | yes | agent1 30%, agent2 70% |
 * | merchant3 | yes | agent1 30%, agent3 30%, agent4 40% |
 * | merchant4 | **none** | none - the step skips it |
 *
 * **MERCHANT_4 is skipped, not posted empty.**
 * `assertShareholderPercentagesTotal` sums the *request*, so an empty batch
 * totals 0, fails the exactly-100 rule and answers 400. A merchant with no
 * agents has nothing to send.
 *
 * ## No unconfigured merchant here
 *
 * A merchant with no fee rows is a real state, and the only way to exercise the
 * 403 `resolveProvider` raises as an onboarding gap on our side rather than a
 * bad request on the merchant's. It is deliberately **not** injected: a step
 * library exists to make merchants work, and a negative case belongs in an E2E
 * spec that can set it up and assert the refusal in one place. Add a fifth
 * merchant here if an injected one is ever wanted - do not take merchant4's
 * rows away, since its no-agent-fee rows are the fixture for the other half of
 * the split.
 *
 * Read it back with `merchantConfigFindAll` to confirm each merchant has one
 * row per pairing: that listing is the only place the row-order hazard above is
 * visible before a transaction trips over it.
 */

import { ROLE } from '@app/microservice/microservice.enum';
import { HttpStatus } from '@nestjs/common';
import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import { BaseFeeDto } from 'apps/dashboard/src/modules/config-fee/dto/base-fee.dto';
import {
  UpsertMerchantAgentShareholderDto,
  UpsertMerchantFeeDto,
} from 'apps/dashboard/src/modules/config-merchant/dto/upsert-merchant-fee.dto';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';
import {
  ADMIN_1,
  ADMIN_PASSWORD,
  adminRegister,
  ADMINS,
  AGENT_PASSWORD,
  AGENT_SHAREHOLDERS,
  AGENTS,
  baseFeeFindAll,
  login,
  loginAgentInternal,
  loginSuperAdmin,
  MERCHANT_FEES,
  MERCHANT_PASSWORD,
  merchantAgentShareholderUpsert,
  merchantConfigFindAll,
  merchantFeeUpsert,
  MERCHANTS,
  UpsertMerchantAgentShareholderBody,
  UpsertMerchantFeeBody,
} from 'apps/uat-local/src/helper';

describe('inject merchant fee', () => {
  let superAdmin: AuthDto;
  let agentInternal: AuthDto;

  const adminAuthDtoByEmail: Map<string, AuthDto> = new Map();
  const merchantAuthDtoByEmail: Map<string, AuthDto> = new Map();
  const agentAuthDtoByEmail: Map<string, AuthDto> = new Map();

  const baseFeeByCode: Map<string, BaseFeeDto> = new Map();

  /**
   * Fixture bodies with their run-time ids filled in, and the join key dropped.
   *
   * One place for it because steps 4 and 6 both need the same answer: step 6
   * reads back what step 4 posted, and resolving it twice by two routes is how
   * they drift. The join key is destructured away rather than spread through -
   * the pipe would strip it anyway, since `whitelist: true` runs without
   * `forbidNonWhitelisted`, but sending a field the DTO does not declare only
   * invites someone to believe it arrived.
   */
  const resolveFees = (
    bodies: UpsertMerchantFeeBody[] | undefined,
  ): UpsertMerchantFeeDto[] =>
    (bodies ?? []).map(({ code, ...body }) => ({
      ...body,
      baseFeeId: baseFeeByCode.get(code)!.id,
    }));

  const resolveShareholders = (
    bodies: UpsertMerchantAgentShareholderBody[] | undefined,
  ): UpsertMerchantAgentShareholderDto[] =>
    (bodies ?? []).map(({ email, ...body }) => ({
      ...body,
      agentId: agentAuthDtoByEmail.get(email)!.authInfo.userId,
    }));

  beforeAll(async () => {
    superAdmin = await loginSuperAdmin();
    expect(superAdmin.token).toBeTruthy();
    expect(superAdmin.authInfo.userId).toBeGreaterThan(0);
    agentInternal = await loginAgentInternal();
    expect(agentInternal.token).toBeTruthy();
    expect(agentInternal.authInfo.userId).toBeGreaterThan(0);
  });

  it('1. register admin', async () => {
    for (const a of ADMINS) {
      const resRegister = await adminRegister(superAdmin, a);
      expect(resRegister.statusCode).toEqual(HttpStatus.CREATED);
      expect(resRegister.status).toBe(ResponseStatus.CREATED);
    }
  });

  it('2. sign in', async () => {
    for (const a of ADMINS) {
      const auth = await login(a.email, ADMIN_PASSWORD);
      expect(auth.token).toBeTruthy();
      expect(auth.authInfo.role).toEqual(ROLE.ADMIN);
      expect(auth.authInfo.userId).toBeGreaterThan(0);
      expect(auth.authInfo.profileId).toBeGreaterThan(0);
      adminAuthDtoByEmail.set(a.email, auth);
    }
    for (const m of MERCHANTS) {
      const auth = await login(m.email, MERCHANT_PASSWORD);
      expect(auth.token).toBeTruthy();
      expect(auth.authInfo.role).toEqual(ROLE.MERCHANT);
      expect(auth.authInfo.userId).toBeGreaterThan(0);
      expect(auth.authInfo.profileId).toBeGreaterThan(0);
      merchantAuthDtoByEmail.set(m.email, auth);
    }
    for (const ag of AGENTS) {
      const auth = await login(ag.email, AGENT_PASSWORD);
      expect(auth.token).toBeTruthy();
      expect(auth.authInfo.role).toEqual(ROLE.AGENT);
      expect(auth.authInfo.userId).toBeGreaterThan(0);
      expect(auth.authInfo.profileId).toBeGreaterThan(0);
      agentAuthDtoByEmail.set(ag.email, auth);
    }
  });

  it('3. base fee find all', async () => {
    const resFindAll = await baseFeeFindAll(superAdmin);
    expect(resFindAll.statusCode).toEqual(HttpStatus.OK);
    expect(resFindAll.status).toBe(ResponseStatus.SUCCESS);
    expect(resFindAll.data).toBeTruthy();

    resFindAll.data!.forEach((b) => {
      baseFeeByCode.set(b.code, b);
    });
  });

  it('4. register merchant fee', async () => {
    const admin = adminAuthDtoByEmail.get(ADMIN_1)!;
    const merchantFees = MERCHANT_FEES();
    for (const [email, authDto] of merchantAuthDtoByEmail) {
      const merchantId = authDto.authInfo.userId;
      const merchantFeeConfigs = resolveFees(merchantFees.get(email));
      const resUpsert = await merchantFeeUpsert(
        admin,
        merchantId,
        merchantFeeConfigs,
      );
      expect(resUpsert.statusCode).toEqual(HttpStatus.CREATED);
      expect(resUpsert.status).toBe(ResponseStatus.CREATED);
    }
  });

  it('5. register agent shareholder', async () => {
    const admin = adminAuthDtoByEmail.get(ADMIN_1)!;
    const agentShareholders = AGENT_SHAREHOLDERS();
    for (const [email, authDto] of merchantAuthDtoByEmail) {
      const merchantId = authDto.authInfo.userId;
      const shared = resolveShareholders(agentShareholders.get(email));

      // A merchant with no agents is skipped rather than posted empty.
      // `assertShareholderPercentagesTotal` sums the *request*, so an empty
      // batch totals 0 and is refused for not being 100 - MERCHANT_4 would
      // fail the step for a reason that is not a defect.
      if (shared.length === 0) continue;

      const resUpsert = await merchantAgentShareholderUpsert(
        admin,
        merchantId,
        shared,
      );
      expect(resUpsert.statusCode).toEqual(HttpStatus.CREATED);
      expect(resUpsert.status).toBe(ResponseStatus.CREATED);
    }
  });

  it('6. find all merchant fee and agent shareholder', async () => {
    const admin = adminAuthDtoByEmail.get(ADMIN_1)!;
    const merchantFees = MERCHANT_FEES();
    const agentShareholders = AGENT_SHAREHOLDERS();
    for (const [email, authDto] of merchantAuthDtoByEmail) {
      const merchantId = authDto.authInfo.userId;

      const resFindAllMerchantFee = await merchantConfigFindAll(
        admin,
        merchantId,
      );
      expect(resFindAllMerchantFee.statusCode).toEqual(HttpStatus.OK);
      expect(resFindAllMerchantFee.status).toBe(ResponseStatus.SUCCESS);
      expect(resFindAllMerchantFee.data).toBeTruthy();
      const merchantFeeConfigs = resolveFees(merchantFees.get(email));
      const feeByBaseFeeId = new Map(
        resFindAllMerchantFee.data!.fees.map((f) => [
          f.merchantFeeConfig!.baseFeeId,
          f,
        ]),
      );
      merchantFeeConfigs.forEach((config) => {
        const row = feeByBaseFeeId.get(config.baseFeeId);
        expect(row).toBeDefined();

        const fee = row!.merchantFeeConfig!;

        expect(fee.feeInternalFixed).toEqual(config.feeInternalFixed);
        expect(fee.feeInternalPercentage).toEqual(config.feeInternalPercentage);
        expect(fee.feeAgentFixed).toEqual(config.feeAgentFixed);
        expect(fee.feeAgentPercentage).toEqual(config.feeAgentPercentage);
      });

      const shareByAgentId = new Map(
        resFindAllMerchantFee.data!.agentShareholders?.map((f) => [
          f.agentId,
          f,
        ]),
      );
      // Resolved from the email again, exactly as step 5 posted them. The
      // fixture carries no `agentId` to read back by - that is the point of
      // the Omit on UpsertMerchantAgentShareholderBody.
      resolveShareholders(agentShareholders.get(email)).forEach((value) => {
        const shared = shareByAgentId.get(value.agentId)!;
        expect(shared).toBeDefined();
        expect(shared.percentagePerAgent).toEqual(value.percentagePerAgent);
      });
    }
  });
});
