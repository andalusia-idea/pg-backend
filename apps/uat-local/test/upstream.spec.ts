import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import {
  loginAgentInternal,
  loginSuperAdmin,
  providerFindAll,
  providerRetire,
  providerUpsert,
  SettlementWindowBody,
  settlementWindowFindAll,
  settlementWindowUpsert,
} from '../src/helper';
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
} from '@app/microservice/microservice.enum';
import { UpsertProviderDto } from 'apps/dashboard/src/super-admin/dto/provider.dto';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';
import { HttpStatus } from '@nestjs/common';

/**
 * The message `callDashboard` throws on a non-2xx, which carries the status and
 * the response body - so a rejection can be asserted on without a try/catch in
 * every case below.
 */
const rejection = async (promise: Promise<unknown>): Promise<string> => {
  const message = await promise.then(
    () => null,
    (error: Error) => error.message,
  );
  expect(message).not.toBeNull();
  return message!;
};

/** Part of the natural key, so every window in this spec shares one instant. */
const IN_FORCE_FROM = '2026-01-01T00:00:00+07:00';

const window = (
  providerName: ProviderNameEnum,
  paymentMethodName: PaymentMethodNameEnum,
  label: string,
  fields: Partial<SettlementWindowBody> = {},
): SettlementWindowBody => ({
  providerName,
  paymentMethodName,
  label,
  windowStart: '00:00',
  windowStartDayOffset: 0,
  windowEnd: '00:00',
  settlementOffset: 1,
  settlementTime: '15:00',
  businessDaysOnly: false,
  effectiveFrom: IN_FORCE_FROM,
  ...fields,
});

/** The providers this spec needs, and the only ones it registers. */
const PROVIDERS = [
  ProviderNameEnum.INTERNAL,
  ProviderNameEnum.JATELINDO,
  ProviderNameEnum.MOTIONPAY,
];

/**
 * Schedules chosen to cover every convention the column comments describe
 * rather than to be realistic.
 *
 * `TELEANJAR` is never activated here. It is the fixture for the "provider is
 * not configured" refusals, and `loadProviderCatalogue` filters
 * `deletedAt: null`, so the retire test below can register and retire it
 * without making those cases unreachable - a retired provider is still not a
 * configured one.
 *
 * **The Jatelindo batch pair carries Teleanjar's times, and is not a
 * transcription.** Teleanjar published those two batches; Jatelindo has
 * published no schedule at all. They are attached to Jatelindo because the
 * batch case needs an *activated* provider and `TELEANJAR` deliberately is not
 * one, per the paragraph above.
 *
 * That matters more than a usual fixture would, because these rows outlive the
 * run: `beforeAll` upserts them into the shared test database, where the "is
 * any rail ambiguous" query in `docs/batch/settlement-policy-explained.md` §14
 * finds them and reports Jatelindo settling TRANSFERBANK in two batches. It
 * does not. The transcribed schedules are in
 * `docs/accounting/upstream-settlement-schedules.md` - under TELEANJAR in
 * `transaction-dev.seed.ts`, which is the one to copy from - and Jatelindo's
 * absence from both is the gap worth filling.
 */
const WINDOWS: SettlementWindowBody[] = [
  // A full day is written end-equals-start. `23:59`, as MotionPay words it,
  // would drop the final minute under the half-open [start, end) convention.
  window(ProviderNameEnum.MOTIONPAY, PaymentMethodNameEnum.QRIS, 'DAILY'),
  // No published time, so `releases` reads "end of day" - eligibility treats
  // null as the end rather than the start, so we never release early.
  window(
    ProviderNameEnum.MOTIONPAY,
    PaymentMethodNameEnum.DIRECTEWALLET,
    'DAILY',
    { settlementOffset: 3, settlementTime: null },
  ),
  // Two batches on one rail: the case `label` is in the natural key for. They
  // tile the day exactly - 18 hours plus 6, batch 2 ending where the next
  // batch 1 begins - so they do not overlap and both are accepted.
  //
  // The times are Teleanjar's, borrowed. See the block above before quoting
  // them at anyone.
  window(
    ProviderNameEnum.JATELINDO,
    PaymentMethodNameEnum.TRANSFERBANK,
    'BATCH_1',
    {
      windowStart: '18:00',
      windowStartDayOffset: -1,
      windowEnd: '12:00',
      settlementOffset: 0,
      settlementTime: '13:00',
    },
  ),
  window(
    ProviderNameEnum.JATELINDO,
    PaymentMethodNameEnum.TRANSFERBANK,
    'BATCH_2',
    {
      windowStart: '12:00',
      windowEnd: '18:00',
      settlementOffset: 0,
      settlementTime: '19:00',
    },
  ),
];

describe('upstream', () => {
  let superAdmin: AuthDto;
  let agentInternal: AuthDto;

  beforeAll(async () => {
    superAdmin = await loginSuperAdmin();
    agentInternal = await loginAgentInternal();
    expect(agentInternal.token).toBeTruthy();
    expect(agentInternal.authInfo.userId).toBeGreaterThan(0);
    expect(superAdmin.token).toBeTruthy();
    expect(superAdmin.authInfo.userId).toBeGreaterThan(0);

    // Setup, not a step. The equivalents under test/inject are what an
    // injection run uses; doing it here too keeps this spec runnable on its
    // own and in any order relative to the other spec files, which jest runs
    // in parallel workers. Both endpoints upsert, so this is idempotent.
    await providerUpsert(
      superAdmin,
      PROVIDERS.map((name) => ({ name }) as UpsertProviderDto),
    );
    await settlementWindowUpsert(superAdmin, WINDOWS);
  });

  it('serves the configured providers', async () => {
    const res = await providerFindAll(superAdmin);
    expect(res.statusCode).toEqual(HttpStatus.OK);
    expect(res.status).toBe(ResponseStatus.SUCCESS);

    const byName = new Map(res.data!.map((p) => [p.name, p]));
    for (const name of PROVIDERS) {
      const provider = byName.get(name)!;
      expect(provider).toBeDefined();
      expect(provider.deletedAt).toBeNull();
      // The closest thing stored to "when did we go live with this partner".
      expect(provider.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/,
      );
    }
  });

  it('serves the configured windows', async () => {
    const res = await settlementWindowFindAll(superAdmin);
    expect(res.statusCode).toEqual(HttpStatus.OK);
    expect(res.status).toBe(ResponseStatus.SUCCESS);

    const mine = res.data!.filter((w) =>
      WINDOWS.some(
        (sent) =>
          sent.providerName === w.providerName &&
          sent.paymentMethodName === w.paymentMethodName &&
          sent.label === w.label,
      ),
    );
    expect(mine.length).toEqual(WINDOWS.length);

    // Ordered providerName asc, paymentMethodName asc, effectiveFrom desc,
    // label asc - the configuration screen reads it top to bottom.
    expect(
      mine.map((w) => `${w.providerName} ${w.paymentMethodName} ${w.label}`),
    ).toEqual([
      'JATELINDO TRANSFERBANK BATCH_1',
      'JATELINDO TRANSFERBANK BATCH_2',
      'MOTIONPAY DIRECTEWALLET DAILY',
      'MOTIONPAY QRIS DAILY',
    ]);

    // The two derived strings, which exist so a listing row needs no
    // formatting logic on the frontend's side.
    expect(mine.map((w) => w.window)).toEqual([
      '18:00 (D-1) - 12:00',
      '12:00 - 18:00',
      '00:00 - 00:00',
      '00:00 - 00:00',
    ]);
    expect(mine.map((w) => w.releases)).toEqual([
      'H+0 13:00',
      'H+0 19:00',
      'H+3 end of day',
      'H+1 15:00',
    ]);

    for (const w of mine) {
      expect(w.id).toBeGreaterThan(0);
      expect(w.timezone).toBe('Asia/Jakarta'); // the column default
      expect(w.businessDaysOnly).toBe(false);
      expect(w.effectiveTo).toBeNull();
      expect(w.deletedAt).toBeNull();
      expect(w.effectiveFrom).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/,
      );
    }
  });

  it('updates a window in place', async () => {
    // Same natural key, a later release time: the upsert has to match the
    // stored row and update it rather than insert a second schedule.
    const resUpsert = await settlementWindowUpsert(superAdmin, [
      window(
        ProviderNameEnum.JATELINDO,
        PaymentMethodNameEnum.TRANSFERBANK,
        'BATCH_2',
        {
          windowStart: '12:00',
          windowEnd: '18:00',
          settlementOffset: 0,
          settlementTime: '20:00',
        },
      ),
    ]);
    expect(resUpsert.statusCode).toEqual(HttpStatus.CREATED);
    expect(resUpsert.status).toBe(ResponseStatus.CREATED);

    const res = await settlementWindowFindAll(superAdmin);
    const matching = res.data!.filter(
      (w) =>
        w.providerName === ProviderNameEnum.JATELINDO && w.label === 'BATCH_2',
    );
    expect(matching.length).toEqual(1);
    expect(matching[0].releases).toBe('H+0 20:00');

    // Put it back, so the fixtures describe the database again.
    await settlementWindowUpsert(superAdmin, WINDOWS);
  });

  it('rejects bad input', async () => {
    // Nothing to apply, and almost certainly a bug in the caller.
    expect(await rejection(settlementWindowUpsert(superAdmin, []))).toContain(
      '-> 400',
    );

    // Two entries sharing a natural key would upsert one row twice and let the
    // later one win, with nothing said about it.
    const duplicate = await rejection(
      settlementWindowUpsert(superAdmin, [
        window(ProviderNameEnum.MOTIONPAY, PaymentMethodNameEnum.QRIS, 'DAILY'),
        window(ProviderNameEnum.MOTIONPAY, PaymentMethodNameEnum.QRIS, 'DAILY'),
      ]),
    );
    expect(duplicate).toContain('-> 400');
    expect(duplicate).toContain('Duplicate settlement window');

    // TELEANJAR is in ProviderNameEnum but is never activated by this suite, so
    // it has no live config.Provider row. This table has no foreign key to it,
    // which is why the service checks rather than relying on Postgres.
    const unknownProvider = await rejection(
      settlementWindowUpsert(superAdmin, [
        window(
          ProviderNameEnum.TELEANJAR,
          PaymentMethodNameEnum.TRANSFERBANK,
          'DAILY',
        ),
      ]),
    );
    expect(unknownProvider).toContain('-> 422');
    expect(unknownProvider).toContain('[0].providerName');
    expect(unknownProvider).toContain('is not configured');

    // Accepted by the shape and refused by the server: the holiday calendar is
    // deliberately unbuilt and eligibility throws rather than treating the flag
    // as false, so a row saved with it set would stop payouts for the rail.
    const businessDays = await rejection(
      settlementWindowUpsert(superAdmin, [
        window(
          ProviderNameEnum.MOTIONPAY,
          PaymentMethodNameEnum.VIRTUALACCOUNT,
          'DAILY',
          { businessDaysOnly: true },
        ),
      ]),
    );
    expect(businessDays).toContain('-> 422');
    expect(businessDays).toContain('[0].businessDaysOnly');

    // 12:00 the previous day to 18:00 today is 30 hours, which is a
    // windowStartDayOffset nobody meant.
    const tooLong = await rejection(
      settlementWindowUpsert(superAdmin, [
        window(
          ProviderNameEnum.MOTIONPAY,
          PaymentMethodNameEnum.VIRTUALACCOUNT,
          'LONG',
          {
            windowStart: '12:00',
            windowStartDayOffset: -1,
            windowEnd: '18:00',
          },
        ),
      ]),
    );
    expect(tooLong).toContain('-> 422');
    expect(tooLong).toContain('[0].windowStartDayOffset');
    expect(tooLong).toContain('30 hours');

    // A schedule that stopped applying before it started.
    const badPeriod = await rejection(
      settlementWindowUpsert(superAdmin, [
        window(
          ProviderNameEnum.MOTIONPAY,
          PaymentMethodNameEnum.VIRTUALACCOUNT,
          'DAILY',
          { effectiveTo: IN_FORCE_FROM },
        ),
      ]),
    );
    expect(badPeriod).toContain('-> 422');
    expect(badPeriod).toContain('[0].effectiveTo');
  });

  it('rejects overlaps', async () => {
    // Against a stored row: a mistyped label does not correct the window from
    // the setup, it creates a second schedule covering the same transactions
    // with nothing to say which wins.
    const againstStored = await rejection(
      settlementWindowUpsert(superAdmin, [
        window(
          ProviderNameEnum.MOTIONPAY,
          PaymentMethodNameEnum.QRIS,
          'DAILY_2',
        ),
      ]),
    );
    expect(againstStored).toContain('-> 422');
    expect(againstStored).toContain('[0].label');
    expect(againstStored).toContain('already stored');

    // And within one request, where neither side is in the table yet.
    const withinRequest = await rejection(
      settlementWindowUpsert(superAdmin, [
        window(
          ProviderNameEnum.MOTIONPAY,
          PaymentMethodNameEnum.VIRTUALACCOUNT,
          'MORNING',
          { windowStart: '00:00', windowEnd: '12:00' },
        ),
        window(
          ProviderNameEnum.MOTIONPAY,
          PaymentMethodNameEnum.VIRTUALACCOUNT,
          'AFTERNOON',
          { windowStart: '06:00', windowEnd: '18:00' },
        ),
      ]),
    );
    expect(withinRequest).toContain('-> 422');
    expect(withinRequest).toContain('also in this request');

    // The refusals above must have written nothing.
    const res = await settlementWindowFindAll(superAdmin);
    expect(
      res.data!.some((w) =>
        ['DAILY_2', 'MORNING', 'AFTERNOON'].includes(w.label),
      ),
    ).toBe(false);
  });

  it('rejects a bad shape', async () => {
    // "24:00" is rejected on purpose: a full day is already expressible as
    // end-equals-start, and a second spelling would put rows in the table that
    // look different and behave identically.
    expect(
      await rejection(
        settlementWindowUpsert(superAdmin, [
          window(
            ProviderNameEnum.MOTIONPAY,
            PaymentMethodNameEnum.VIRTUALACCOUNT,
            'DAILY',
            { windowStart: '24:00' },
          ),
        ]),
      ),
    ).toContain('-> 422');

    // Labels are part of the natural key, so they are kept to one shape.
    expect(
      await rejection(
        settlementWindowUpsert(superAdmin, [
          window(
            ProviderNameEnum.MOTIONPAY,
            PaymentMethodNameEnum.VIRTUALACCOUNT,
            'daily',
          ),
        ]),
      ),
    ).toContain('-> 422');

    // Only the previous day or the day itself; a window never opens tomorrow.
    expect(
      await rejection(
        settlementWindowUpsert(superAdmin, [
          window(
            ProviderNameEnum.MOTIONPAY,
            PaymentMethodNameEnum.VIRTUALACCOUNT,
            'DAILY',
            { windowStartDayOffset: 1 },
          ),
        ]),
      ),
    ).toContain('-> 422');

    // A release more than a month after the window closes is a typo.
    expect(
      await rejection(
        settlementWindowUpsert(superAdmin, [
          window(
            ProviderNameEnum.MOTIONPAY,
            PaymentMethodNameEnum.VIRTUALACCOUNT,
            'DAILY',
            { settlementOffset: 99 },
          ),
        ]),
      ),
    ).toContain('-> 422');
  });

  it('retires a provider, and refuses the ones it must not', async () => {
    // TELEANJAR has no base fees, so retiring it is allowed - and it stays the
    // "not configured" fixture afterwards, because loadProviderCatalogue
    // filters deletedAt: null and a retired provider therefore does not count
    // as configured.
    await providerUpsert(superAdmin, [
      { name: ProviderNameEnum.TELEANJAR } as UpsertProviderDto,
    ]);
    const resRetire = await providerRetire(superAdmin, [
      { name: ProviderNameEnum.TELEANJAR },
    ]);
    expect(resRetire.statusCode).toEqual(HttpStatus.CREATED);

    const retired = (await providerFindAll(superAdmin)).data!.find(
      (p) => p.name === ProviderNameEnum.TELEANJAR,
    )!;
    expect(retired.deletedAt).not.toBeNull();

    // The desired end state is already true, so doing it twice is not an error.
    expect(
      (await providerRetire(superAdmin, [{ name: ProviderNameEnum.TELEANJAR }]))
        .statusCode,
    ).toEqual(HttpStatus.CREATED);

    // INTERNAL is the house provider: engine data, excluded from the dropdowns
    // because no merchant routes to it, and what admins and agent-less agents
    // resolve to. Retiring it is never meant.
    const internal = await rejection(
      providerRetire(superAdmin, [{ name: ProviderNameEnum.INTERNAL }]),
    );
    expect(internal).toContain('-> 422');
    expect(internal).toContain('house provider');

    // A provider with live base fees is refused, because nothing in the
    // routing path reads this table - retiring it would hide it from the
    // dropdowns and keep sending transactions to it. base-fee.spec.ts may or
    // may not have configured MOTIONPAY by now, so this asserts the outcome is
    // one of the two correct ones rather than racing it.
    const motionpay = await providerRetire(superAdmin, [
      { name: ProviderNameEnum.MOTIONPAY },
    ]).then(
      () => 'retired',
      (error: Error) => error.message,
    );
    if (motionpay !== 'retired') {
      expect(motionpay).toContain('-> 422');
      expect(motionpay).toContain('active base fee');
    }
    // Either way MOTIONPAY has to end up usable for everything else.
    await providerUpsert(superAdmin, [
      { name: ProviderNameEnum.MOTIONPAY } as UpsertProviderDto,
    ]);
  });

  it('is super admin only', async () => {
    // RolesGuard is registered and the controller carries
    // @Roles(ROLE.SUPER_ADMIN), so agentinternal gets a 403 here rather than
    // being waved through - unlike the endpoints that rely on @CheckPolicies().
    expect(
      await rejection(settlementWindowUpsert(agentInternal, WINDOWS)),
    ).toContain('-> 403');
    expect(await rejection(settlementWindowFindAll(agentInternal))).toContain(
      '-> 403',
    );
    expect(await rejection(providerFindAll(agentInternal))).toContain('-> 403');
    expect(
      await rejection(
        providerUpsert(agentInternal, [
          { name: ProviderNameEnum.MOTIONPAY } as UpsertProviderDto,
        ]),
      ),
    ).toContain('-> 403');
  });
});
