/**
 * Step 01 - upstream providers and their settlement schedules.
 *
 * First because almost everything else references a provider:
 * `BaseFee.providerName` is a real foreign key to `config.Provider`, and the
 * settlement-window upsert refuses a provider that is not configured.
 *
 * ## What to inject
 *
 * 1. **Providers**, via `providerUpsert(superAdmin, [...])`.
 *
 *    `INTERNAL`, `MOTIONPAY` and `JATELINDO`. The migrations insert `INTERNAL`
 *    alone - every other provider exists because a contract was signed - so
 *    re-posting it is a harmless no-op that keeps the list in one place.
 *
 *    **Leave `TELEANJAR` out.** It is the fixture the E2E specs use for the
 *    "provider is not configured" refusal, and registering it here would make
 *    that case unreachable after an injection run. It has no upstream client
 *    either, so nothing can route to it.
 *
 * 2. **Settlement windows**, via `settlementWindowUpsert(superAdmin, [...])`.
 *
 *    When each partner closes a transaction window and releases our money.
 *    `FOLLOW_UPSTREAM` eligibility cannot answer anything without these, so a
 *    settlement run has nothing to compute until they exist.
 *
 *    `docs/accounting/upstream-settlement-schedules.md` is the source. What is
 *    published today:
 *
 *    | Provider | Method | Label | Window | Releases |
 *    |---|---|---|---|---|
 *    | MOTIONPAY | QRIS | DAILY | full day | H+1 15:00 |
 *    | MOTIONPAY | DIRECTEWALLET | DAILY | full day | H+3, no published time |
 *
 *    Two conventions the column comments spell out and the API enforces:
 *    a **full day is `windowEnd` equal to `windowStart`** (`"24:00"` is
 *    refused, so there is only one spelling), and
 *    **`windowStartDayOffset: -1`** when the window opens the previous day.
 *    `settlementTime: null` means no published time, which eligibility reads as
 *    end of day rather than start.
 *
 *    **MotionPay is the only provider with windows, and that is not a gap.** A
 *    window affects *payin* settlement and nothing else - the claim reads
 *    `transaction.PurchaseTransaction` - while Jatelindo serves payouts only,
 *    WITHDRAW and DISBURSEMENT. A schedule for TRANSFERBANK or a
 *    TRANSFEREWALLET_* method could never match a row, and giving one of those
 *    methods a window would make the enqueuer create runs that claim nothing.
 *    The comment on `SETTLEMENT_WINDOWS` in `src/helper/constant.ts` has the
 *    reasoning in full.
 *
 * Fixtures belong in `src/helper/constant.ts` beside `BASE_FEES`, not here.
 */

import { HttpStatus } from '@nestjs/common';
import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';
import { UpsertProviderDto } from 'apps/dashboard/src/super-admin/dto';
import {
  loginSuperAdmin,
  providerFindAll,
  PROVIDERS,
  providerUpsert,
  SETTLEMENT_WINDOWS,
  settlementWindowFindAll,
  settlementWindowUpsert,
} from 'apps/uat-local/src/helper';

describe('inject upstream', () => {
  let superAdmin: AuthDto;

  beforeAll(async () => {
    superAdmin = await loginSuperAdmin();
    expect(superAdmin.token).toBeTruthy();
    expect(superAdmin.authInfo.userId).toBeGreaterThan(0);
  });

  it('1 register provider', async () => {
    const providers = PROVIDERS.map<UpsertProviderDto>((p) => ({ name: p }));
    const resUpsert = await providerUpsert(superAdmin, providers);
    expect(resUpsert.statusCode).toEqual(HttpStatus.CREATED);
    expect(resUpsert.status).toBe(ResponseStatus.CREATED);

    const resFindAll = await providerFindAll(superAdmin);
    expect(resFindAll.statusCode).toEqual(HttpStatus.OK);
    expect(resFindAll.status).toBe(ResponseStatus.SUCCESS);

    const byName = new Map(resFindAll.data!.map((p) => [p.name, p]));
    for (const p of PROVIDERS) {
      const provider = byName.get(p);
      expect(provider).toBeDefined();
      expect(provider?.deletedAt).toBeNull();
    }
  });

  it('2 settlement windows', async () => {
    const resUpsert = await settlementWindowUpsert(
      superAdmin,
      SETTLEMENT_WINDOWS,
    );
    expect(resUpsert.statusCode).toEqual(HttpStatus.CREATED);
    expect(resUpsert.status).toBe(ResponseStatus.CREATED);

    const resFindAll = await settlementWindowFindAll(superAdmin);
    expect(resFindAll.statusCode).toEqual(HttpStatus.OK);
    expect(resFindAll.status).toBe(ResponseStatus.SUCCESS);

    // The natural key without `effectiveFrom`: the fixture carries one schedule
    // per rail, so provider + method + label identifies a row inside it. Keyed
    // rather than compared by index because the GET orders by rail, not by the
    // order the payload was sent in - and deliberately not an exact count,
    // since the E2E specs upsert their own fixtures into the same database.
    const byKey = new Map(
      resFindAll.data!.map((w) => [
        `${w.providerName}|${w.paymentMethodName}|${w.label}`,
        w,
      ]),
    );

    for (const sent of SETTLEMENT_WINDOWS) {
      const key = `${sent.providerName}|${sent.paymentMethodName}|${sent.label}`;
      const stored = byKey.get(key);

      expect(stored).toBeDefined();
      expect(stored!.deletedAt).toBeNull();
      expect(stored!.effectiveTo).toBeNull();

      // Field by field rather than through the derived `window` / `releases`
      // strings: this step cares that the stored values are the ones it meant
      // to inject, and an hour wrong in any of them moves the payout time for
      // every merchant on the rail. The derived strings are presentation, and
      // test/upstream.spec.ts covers them.
      expect(stored!.windowStart).toEqual(sent.windowStart);
      expect(stored!.windowStartDayOffset).toEqual(sent.windowStartDayOffset);
      expect(stored!.windowEnd).toEqual(sent.windowEnd);
      expect(stored!.settlementOffset).toEqual(sent.settlementOffset);
      expect(stored!.settlementTime).toEqual(sent.settlementTime ?? null);
      expect(stored!.businessDaysOnly).toEqual(sent.businessDaysOnly);

      // The fixture omits `timezone`, so this is the server's default landing.
      expect(stored!.timezone).toEqual(sent.timezone ?? 'Asia/Jakarta');

      // Compared as instants, not as strings: `effectiveFrom` is in the natural
      // key, so a schedule in force from a different moment is a new row rather
      // than a correction of this one.
      expect(new Date(stored!.effectiveFrom).getTime()).toEqual(
        new Date(sent.effectiveFrom).getTime(),
      );
    }
  });
});
