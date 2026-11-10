import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import {
  callDashboard,
  loginAgentInternal,
  loginSuperAdmin,
} from '../src/helper';
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
} from '@app/microservice/microservice.enum';
import {
  ProviderDto,
  UpsertProviderDto,
} from 'apps/dashboard/src/super-admin/dto/provider.dto';
import {
  SettlementWindowDto,
  UpsertSettlementWindowDto,
} from 'apps/dashboard/src/super-admin/dto/settlement-window.dto';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';

const upstreamRegister = async (
  authDto: AuthDto,
  providerName: UpsertProviderDto[],
) => {
  const res = await callDashboard<null>({
    method: 'POST',
    url: '/api/v1/super-admin/provider',
    data: providerName,
    headers: {
      Authorization: `Bearer ${authDto.token}`,
    },
  });
  return res;
};

const upstreamFindAll = async (authDto: AuthDto) => {
  const res = await callDashboard<ProviderDto[]>({
    method: 'GET',
    url: '/api/v1/super-admin/provider',
    headers: {
      Authorization: `Bearer ${authDto.token}`,
    },
  });
  return res;
};

/**
 * The JSON shape of `UpsertSettlementWindowDto`.
 *
 * The DTO types `effectiveFrom` as a `Date` because `@ToJsDate()` has already
 * run by the time a handler sees it. On the wire it is an ISO 8601 string with
 * an explicit offset, so a request body is this shape rather than the DTO's.
 */
type SettlementWindowBody = Omit<
  UpsertSettlementWindowDto,
  'effectiveFrom' | 'effectiveTo'
> & { effectiveFrom: string; effectiveTo?: string | null };

const settlementWindowUpsert = async (
  authDto: AuthDto,
  windows: SettlementWindowBody[],
) => {
  const res = await callDashboard<null>({
    method: 'POST',
    url: '/api/v1/super-admin/settlement-window',
    data: windows,
    headers: {
      Authorization: `Bearer ${authDto.token}`,
    },
  });
  return res;
};

const settlementWindowFindAll = async (authDto: AuthDto) => {
  const res = await callDashboard<SettlementWindowDto[]>({
    method: 'GET',
    url: '/api/v1/super-admin/settlement-window',
    headers: {
      Authorization: `Bearer ${authDto.token}`,
    },
  });
  return res;
};

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

/**
 * The schedules this spec installs, chosen to cover every convention the column
 * comments describe rather than to be realistic.
 *
 * MOTIONPAY and JATELINDO only. TELEANJAR is deliberately never registered as a
 * provider: it is the fixture for the "provider is not configured" refusal, and
 * leaving it out keeps that case reachable on every run - as well as keeping
 * `register` above able to assert an exact provider count.
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
    {
      settlementOffset: 3,
      settlementTime: null,
    },
  ),
  // Two batches on one rail: the case `label` is in the natural key for. They
  // tile the day exactly - 18 hours plus 6, batch 2 ending where the next
  // batch 1 begins - so they do not overlap and both are accepted.
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
  });

  it('register', async () => {
    const providers = [
      ProviderNameEnum.INTERNAL,
      ProviderNameEnum.JATELINDO,
      ProviderNameEnum.MOTIONPAY,
    ];
    const resRegister = await upstreamRegister(
      superAdmin,
      providers.map((p) => ({ name: p }) as UpsertProviderDto),
    );
    expect(resRegister.statusCode).toEqual(201);
    expect(resRegister.status).toBe(ResponseStatus.CREATED);

    const resFindAll = await upstreamFindAll(superAdmin);
    expect(resFindAll.statusCode).toEqual(200);
    expect(resFindAll.status).toBe(ResponseStatus.SUCCESS);
    expect(resFindAll.data).toBeTruthy();
    expect(resFindAll.data?.length).toEqual(providers.length); // INTERNAL already seed
    for (const p of resFindAll.data!) {
      expect(providers).toContain(p.name);
    }
  });

  it('settlement window', async () => {
    const resUpsert = await settlementWindowUpsert(superAdmin, WINDOWS);
    expect(resUpsert.statusCode).toEqual(201);
    expect(resUpsert.status).toBe(ResponseStatus.CREATED);

    const resFindAll = await settlementWindowFindAll(superAdmin);
    expect(resFindAll.statusCode).toEqual(200);
    expect(resFindAll.status).toBe(ResponseStatus.SUCCESS);
    expect(resFindAll.data).toBeTruthy();
    expect(resFindAll.data?.length).toEqual(WINDOWS.length);

    // Ordered providerName asc, paymentMethodName asc, effectiveFrom desc,
    // label asc - the configuration screen reads it top to bottom.
    expect(
      resFindAll.data!.map(
        (w) => `${w.providerName} ${w.paymentMethodName} ${w.label}`,
      ),
    ).toEqual([
      'JATELINDO TRANSFERBANK BATCH_1',
      'JATELINDO TRANSFERBANK BATCH_2',
      'MOTIONPAY DIRECTEWALLET DAILY',
      'MOTIONPAY QRIS DAILY',
    ]);

    // The two derived strings, which exist so a listing row needs no formatting
    // logic on the frontend's side.
    expect(resFindAll.data!.map((w) => w.window)).toEqual([
      '18:00 (D-1) - 12:00',
      '12:00 - 18:00',
      '00:00 - 00:00',
      '00:00 - 00:00',
    ]);
    expect(resFindAll.data!.map((w) => w.releases)).toEqual([
      'H+0 13:00',
      'H+0 19:00',
      'H+3 end of day',
      'H+1 15:00',
    ]);

    for (const w of resFindAll.data!) {
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

  it('settlement window update', async () => {
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
    expect(resUpsert.statusCode).toEqual(201);

    const resFindAll = await settlementWindowFindAll(superAdmin);
    expect(resFindAll.data?.length).toEqual(WINDOWS.length);
    expect(resFindAll.data!.find((w) => w.label === 'BATCH_2')?.releases).toBe(
      'H+0 20:00',
    );
  });

  it('settlement window rejects bad input', async () => {
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

    // TELEANJAR is in ProviderNameEnum but was never registered, so there is no
    // config.Provider row. This table has no foreign key to it, which is why
    // the service checks rather than relying on Postgres.
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
          {
            businessDaysOnly: true,
          },
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
          {
            effectiveTo: IN_FORCE_FROM,
          },
        ),
      ]),
    );
    expect(badPeriod).toContain('-> 422');
    expect(badPeriod).toContain('[0].effectiveTo');
  });

  it('settlement window rejects overlaps', async () => {
    // Against a stored row: a mistyped label does not correct the window from
    // the first test, it creates a second schedule covering the same
    // transactions with nothing to say which wins.
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
          {
            windowStart: '00:00',
            windowEnd: '12:00',
          },
        ),
        window(
          ProviderNameEnum.MOTIONPAY,
          PaymentMethodNameEnum.VIRTUALACCOUNT,
          'AFTERNOON',
          {
            windowStart: '06:00',
            windowEnd: '18:00',
          },
        ),
      ]),
    );
    expect(withinRequest).toContain('-> 422');
    expect(withinRequest).toContain('also in this request');

    // The refusals above must have written nothing.
    const resFindAll = await settlementWindowFindAll(superAdmin);
    expect(resFindAll.data?.length).toEqual(WINDOWS.length);
  });

  it('settlement window rejects a bad shape', async () => {
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
            {
              windowStart: '24:00',
            },
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
            {
              windowStartDayOffset: 1,
            },
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
            {
              settlementOffset: 99,
            },
          ),
        ]),
      ),
    ).toContain('-> 422');
  });

  it('settlement window is super admin only', async () => {
    // RolesGuard is registered and the controller carries
    // @Roles(ROLE.SUPER_ADMIN), so agentinternal gets a 403 here rather than
    // being waved through - unlike the endpoints that rely on @CheckPolicies().
    expect(
      await rejection(settlementWindowUpsert(agentInternal, WINDOWS)),
    ).toContain('-> 403');
    expect(await rejection(settlementWindowFindAll(agentInternal))).toContain(
      '-> 403',
    );
  });
});
