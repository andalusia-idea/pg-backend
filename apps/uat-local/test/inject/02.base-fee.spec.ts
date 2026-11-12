/**
 * Step 02 - provider-level base fees.
 *
 * After 01 because `BaseFee.providerName` is a real foreign key to
 * `config.Provider`, and before 05 because a merchant's own fee override
 * carries a `baseFeeId` that has to exist first.
 *
 * ## What to inject
 *
 * **`baseFeeUpsert(superAdmin, BASE_FEES)`**, with the fixtures already in
 * `src/helper/constant.ts` - one MotionPay QRIS purchase rail and six Jatelindo
 * payout rails.
 *
 * Then read it back with `baseFeeFindAll` and check the stored rates against
 * the fixtures. The upsert answers 201 with no body, so the GET is the only
 * confirmation that what landed is what was sent - and `code`, the
 * `PROVIDER_METHOD_TYPE` string `baseFeeCode()` builds, is what joins a
 * response row back to the fixture that produced it.
 *
 * **Step 05 cannot be handed these ids.** `UpsertMerchantFeeDto.baseFeeId` is
 * the only way a merchant fee points at a rail, but the runner spawns one jest
 * process per step file, so nothing in this module's scope survives to 05 - it
 * calls `baseFeeFindAll` itself.
 *
 * ## What the server will refuse, so the fixtures have to respect it
 *
 * - **`isActive` must be a real JSON boolean.** A string, or omitting it, is a
 *   422 - and before `@IsBoolean()` was added it was stripped silently, so a
 *   fee could not be deactivated at all.
 * - **The transaction type has to be one the payment method supports.**
 *   `PaymentMethod.transactionTypes` is an array column with no constraint
 *   relating the two, so a QRIS withdrawal would insert happily and then never
 *   match a transaction again. The API checks instead, naming the supported
 *   types.
 * - **Money is 2 decimal places, percentage is 4.** Both cross as strings.
 *   `ZERO` in the helper is built at the money scale, so a zero percentage is
 *   written `'0.00'` and comes back `'0.0000'` - accepted, just worth knowing
 *   it is not string-identical.
 *
 * ## Rates are invented, and that matters
 *
 * Real provider rates are commercial terms from a signed agreement. A database
 * carrying plausible-but-fictional ones is worse than one carrying none,
 * because nothing fails loudly - the fees are simply wrong and every settlement
 * quietly mis-splits. These are harness numbers; the production path is an
 * operator entering them through this same endpoint by hand.
 */

import { HttpStatus } from '@nestjs/common';
import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';
import {
  BASE_FEE_CODES,
  BASE_FEES,
  baseFeeFindAll,
  baseFeeUpsert,
  loginSuperAdmin,
} from 'apps/uat-local/src/helper';

describe('inject base fee', () => {
  let superAdmin: AuthDto;

  beforeAll(async () => {
    superAdmin = await loginSuperAdmin();
    expect(superAdmin.token).toBeTruthy();
    expect(superAdmin.authInfo.userId).toBeGreaterThan(0);
  });

  it('1 register base fee', async () => {
    const resUpsert = await baseFeeUpsert(superAdmin, BASE_FEES);
    expect(resUpsert.statusCode).toEqual(HttpStatus.CREATED);
    expect(resUpsert.status).toBe(ResponseStatus.CREATED);

    const resFindAll = await baseFeeFindAll(superAdmin);
    expect(resFindAll.statusCode).toEqual(HttpStatus.OK);
    expect(resFindAll.status).toBe(ResponseStatus.SUCCESS);
    expect(resFindAll.data).toBeTruthy();

    const byCode = new Map(resFindAll.data!.map((b) => [b.code, b]));

    // BASE_FEE_CODES is baseFeeCode(BASE_FEES), so it stays index-aligned with
    // the fixtures. Keyed rather than compared position by position, because
    // the GET serves every rail, including ones the E2E specs upserted.
    BASE_FEES.forEach((sent, index) => {
      const stored = byCode.get(BASE_FEE_CODES[index]);

      expect(stored).toBeDefined();
      expect(stored!.isActive).toEqual(sent.isActive);
      expect(stored!.deletedAt).toBeNull();

      // Compared as numbers, not as strings: money is Decimal(15,2) and the
      // percentage Decimal(8,4), so the helper's `ZERO` goes out as '0.00' and
      // comes back '0.0000'. Equal decimal values parse to equal doubles, so
      // this is exact at these scales - and the rates are the point of the
      // step, since one wrong here mis-splits every settlement silently.
      expect(Number(stored!.feeProviderFixed)).toEqual(
        Number(sent.feeProviderFixed),
      );
      expect(Number(stored!.feeProviderPercentage)).toEqual(
        Number(sent.feeProviderPercentage),
      );
    });
  });
});
