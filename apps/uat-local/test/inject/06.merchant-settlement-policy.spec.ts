/**
 * Step 06 - each merchant's settlement terms.
 *
 * Last, and after 04 for two reasons. The obvious one is that it needs merchant
 * ids. The other is that `registerMerchant` already wrote every merchant a
 * default `FOLLOW_UPSTREAM` row on `'*'`, so this step is always *superseding*
 * rather than creating from nothing - which is why `POLICY_IN_FORCE_FROM` reads
 * the clock instead of using the fixed date SETTLEMENT_WINDOWS uses. The
 * comment on it in `src/helper/constant.ts` has the whole argument.
 *
 * ## What to inject
 *
 * **`merchantSettlementPolicyUpsert(admin, merchantId, policies)`** per
 * merchant, from `MERCHANT_SETTLEMENT_POLICY`. All four modes are covered:
 *
 * | Merchant | Terms |
 * |---|---|
 * | merchant1 | `FOLLOW_UPSTREAM` on `'*'` - the honest default, re-stated |
 * | merchant2 | `FIXED_DELAY` T+1 at 13:00 on `'*'`, overridden to `SCHEDULED` six times a day on QRIS |
 * | merchant3 | `SCHEDULED` twelve times a day on `'*'` |
 * | merchant4 | `INSTANT` on `'*'` - we advance it money |
 *
 * **ADMIN, not agentinternal.** These two routes are the only ones in
 * `ConfigMerchantController` with an enforced role
 * (`@Roles(...MERCHANT_TERMS_ROLES)`), so an AGENT or MERCHANT token gets a
 * 403 here even though the fee and shareholder writes beside them accept
 * anything authenticated.
 *
 * ## Idempotent, unlike 03 through 05
 *
 * The upsert corrects a row that shares `(paymentMethodName, effectiveFrom)`,
 * so re-running this step inside one process is safe. Re-running it in a *new*
 * process is not: `POLICY_IN_FORCE_FROM` is read at import, so a second run
 * supersedes the first rather than replacing it. Reset the database.
 *
 * ## Reading the GET back
 *
 * It serves superseded and retired rows too, newest first per method, so a
 * method appears more than once as soon as anything has superseded it - which
 * here is immediately, because of the registration default. Keying a map on
 * `paymentMethodName` alone would therefore hand back the *oldest* row.
 */

import { ROLE } from '@app/microservice/microservice.enum';
import { SettlementModeEnum } from '@app/microservice';
import { HttpStatus } from '@nestjs/common';
import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import { UpsertMerchantSettlementPolicyDto } from 'apps/dashboard/src/modules/config-merchant/dto/settlement-policy.dto';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';
import {
  ADMIN_1,
  ADMIN_PASSWORD,
  ADMINS,
  login,
  MERCHANT_PASSWORD,
  MERCHANT_SETTLEMENT_POLICY,
  MERCHANTS,
  merchantSettlementPolicyFindAll,
  merchantSettlementPolicyUpsert,
} from 'apps/uat-local/src/helper';

/** What `MerchantSettlementPolicyDto` should derive for a given fixture row. */
const expectedReleases = (
  sent: UpsertMerchantSettlementPolicyDto,
): string | undefined => {
  const times = [...(sent.releaseTimes ?? [])].sort();

  switch (sent.mode) {
    case SettlementModeEnum.INSTANT:
      return 'immediately on capture';
    case SettlementModeEnum.FOLLOW_UPSTREAM:
      return 'when the upstream settles';
    case SettlementModeEnum.FIXED_DELAY:
      return `T+${sent.delayDays} at ${times[0]}`;
    case SettlementModeEnum.SCHEDULED:
      return `daily at ${times.join(', ')}`;
  }
};

describe('inject merchant settlement policy', () => {
  const adminAuthDtoByEmail: Map<string, AuthDto> = new Map();
  const merchantAuthDtoByEmail: Map<string, AuthDto> = new Map();

  beforeAll(async () => {
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
  });

  it('1. register merchant settlement policy', async () => {
    const admin = adminAuthDtoByEmail.get(ADMIN_1)!;

    for (const [email, policies] of MERCHANT_SETTLEMENT_POLICY) {
      const merchantId = merchantAuthDtoByEmail.get(email)!.authInfo.userId;
      const resUpsert = await merchantSettlementPolicyUpsert(
        admin,
        merchantId,
        policies,
      );
      expect(resUpsert.statusCode).toEqual(HttpStatus.CREATED);
      expect(resUpsert.status).toBe(ResponseStatus.CREATED);

      const resFindAll = await merchantSettlementPolicyFindAll(
        admin,
        merchantId,
      );
      expect(resFindAll.statusCode).toEqual(HttpStatus.OK);
      expect(resFindAll.status).toBe(ResponseStatus.SUCCESS);
      expect(resFindAll.data).toBeTruthy();

      // Keyed on method *and* effectiveFrom. Every merchant carries the
      // registration default on `'*'` as well, so the method alone is not
      // unique and a Map would keep the last entry for it - which, ordered
      // newest first, is the superseded row rather than the one just written.
      const byKey = new Map(
        resFindAll.data!.map((p) => [
          `${p.paymentMethodName}|${new Date(p.effectiveFrom).getTime()}`,
          p,
        ]),
      );

      for (const sent of policies) {
        const policy = byKey.get(
          `${sent.paymentMethodName}|${sent.effectiveFrom.getTime()}`,
        );

        expect(policy).toBeDefined();
        expect(policy!.mode).toEqual(sent.mode);
        expect(policy!.delayDays).toEqual(sent.delayDays ?? null);
        expect(policy!.businessDaysOnly).toEqual(sent.businessDaysOnly);
        expect(policy!.deletedAt).toBeNull();

        // The fixture omits releaseTimes for the two modes that ignore them;
        // the server stores an empty array.
        expect(policy!.releaseTimes).toEqual(sent.releaseTimes ?? []);

        // The derived string the frontend renders, restated here rather than
        // reused from the DTO - if the formatter changes, this should notice.
        expect(policy!.releases).toEqual(expectedReleases(sent));

        // Newly written terms are the current ones, since this step always
        // supersedes the registration default rather than following it.
        expect(policy!.effectiveTo).toBeNull();
      }
    }
  });
});
