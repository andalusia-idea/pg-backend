import { AuthDto } from 'apps/dashboard/src/auth/dto/auth.dto';
import {
  BASE_FEES,
  baseFeeCode,
  baseFeeFindAll,
  baseFeeUpsert,
  feeConfigFindAll,
  loginAgentInternal,
  loginSuperAdmin,
  providerUpsert,
} from '../src/helper';
import { UpsertBaseFeeDto } from 'apps/dashboard/src/super-admin/dto/base-fee.dto';
import { UpsertProviderDto } from 'apps/dashboard/src/super-admin/dto/provider.dto';
import { ResponseStatus } from 'apps/dashboard/src/shared/response.dto';
import {
  PaymentMethodNameEnum,
  ProviderNameEnum,
  TransactionTypeEnum,
} from '@app/microservice/microservice.enum';
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

const CODES = baseFeeCode(BASE_FEES);

/** One fixture copied with fields overridden, so a case says what it changes. */
const like = (
  fee: UpsertBaseFeeDto,
  fields: Partial<UpsertBaseFeeDto> = {},
): UpsertBaseFeeDto => ({ ...fee, ...fields });

/**
 * The rail this spec switches off and back on.
 *
 * Deliberately a wallet rail rather than QRIS or TRANSFERBANK: routing filters
 * `baseFee.isActive`, so a rail left off is a rail no merchant can transact on,
 * and those two are the ones anything else in the suite would want. Restored
 * within each test regardless, but choosing the spare one means a failure
 * part-way through cannot strand a main rail.
 */
const SPARE_RAIL = BASE_FEES.find(
  (fee) => fee.paymentMethodName === PaymentMethodNameEnum.TRANSFEREWALLET_OVO,
)!;

describe('base fee', () => {
  let superAdmin: AuthDto;
  let agentInternal: AuthDto;

  beforeAll(async () => {
    superAdmin = await loginSuperAdmin();
    agentInternal = await loginAgentInternal();
    expect(agentInternal.token).toBeTruthy();
    expect(agentInternal.authInfo.userId).toBeGreaterThan(0);
    expect(superAdmin.token).toBeTruthy();
    expect(superAdmin.authInfo.userId).toBeGreaterThan(0);

    // Setup, not a step. test/inject/02.base-fee.spec.ts is what an injection
    // run uses; doing it here too keeps this spec runnable on its own and in
    // any order relative to the other spec files, which jest runs in parallel
    // workers. Both endpoints upsert, so this is idempotent.
    //
    // `BaseFee.providerName` is a real foreign key to `config.Provider`, so the
    // providers go first. Derived from the fixtures rather than listed.
    const providers = [...new Set(BASE_FEES.map((fee) => fee.providerName))];
    await providerUpsert(
      superAdmin,
      providers.map((name) => ({ name }) as UpsertProviderDto),
    );
    await baseFeeUpsert(superAdmin, BASE_FEES);
  });

  it('serves what was configured', async () => {
    const res = await baseFeeFindAll(superAdmin);
    expect(res.statusCode).toEqual(HttpStatus.OK);
    expect(res.status).toBe(ResponseStatus.SUCCESS);
    expect(res.data).toBeTruthy();

    const codes = res.data!.map((row) => row.code);
    for (const code of CODES) {
      expect(codes).toContainEqual(code);
    }

    // The rates round-trip by value, and the response pins its own scale:
    // Money always 2 decimal places, Percentage always 4. Compared as numbers
    // rather than strings on purpose - the fixtures spell a zero percentage
    // '0.00', because `ZERO` in the helper is built at the money scale and does
    // double duty, and the response correctly returns '0.0000'. The contract is
    // the value plus the scale, not the caller's spelling.
    const byCode = new Map(res.data!.map((row) => [row.code, row]));
    for (const fee of BASE_FEES) {
      const row = byCode.get(baseFeeCode([fee])[0])!;
      expect(Number(row.feeProviderFixed)).toEqual(
        Number(fee.feeProviderFixed),
      );
      expect(Number(row.feeProviderPercentage)).toEqual(
        Number(fee.feeProviderPercentage),
      );
      expect(row.feeProviderFixed).toMatch(/^\d+\.\d{2}$/);
      expect(row.feeProviderPercentage).toMatch(/^\d+\.\d{4}$/);
      expect(row.isActive).toBe(true);
      expect(row.deletedAt).toBeNull();
      expect(row.id).toBeGreaterThan(0);
    }
  });

  it('updates a fee in place', async () => {
    // Same natural key, a different rate: the upsert has to match the stored
    // row and update it rather than insert a second fee for the same triple.
    const code = baseFeeCode([SPARE_RAIL])[0];

    const resUpsert = await baseFeeUpsert(superAdmin, [
      like(SPARE_RAIL, { feeProviderFixed: '800.00' }),
    ]);
    expect(resUpsert.statusCode).toEqual(HttpStatus.CREATED);
    expect(resUpsert.status).toBe(ResponseStatus.CREATED);

    const res = await baseFeeFindAll(superAdmin);
    const matching = res.data!.filter((row) => row.code === code);
    expect(matching.length).toEqual(1);
    expect(matching[0].feeProviderFixed).toBe('800.00');

    // Put it back, so the fixtures describe the database again.
    await baseFeeUpsert(superAdmin, [SPARE_RAIL]);
    const resRestored = await baseFeeFindAll(superAdmin);
    expect(
      resRestored.data!.find((row) => row.code === code)?.feeProviderFixed,
    ).toBe(SPARE_RAIL.feeProviderFixed);
  });

  it('deactivates a fee, visibly on both reads', async () => {
    const code = baseFeeCode([SPARE_RAIL])[0];

    const resUpsert = await baseFeeUpsert(superAdmin, [
      like(SPARE_RAIL, { isActive: false }),
    ]);
    expect(resUpsert.statusCode).toEqual(HttpStatus.CREATED);

    // Visible on the configuration view...
    const resAdmin = await baseFeeFindAll(superAdmin);
    expect(resAdmin.data!.find((row) => row.code === code)?.isActive).toBe(
      false,
    );

    // ...and on the operational read, which is the half that was missing until
    // `isActive` reached BaseFeeDto. /fee/config filters only `deletedAt`, so
    // it returns deactivated fees - and routing skips them, which made a
    // deactivated rail indistinguishable from a live one.
    const resConfig = await feeConfigFindAll(superAdmin);
    expect(resConfig.statusCode).toEqual(HttpStatus.OK);
    const operational = resConfig.data!.find((row) => row.code === code)!;
    expect(operational.isActive).toBe(false);
    expect(operational.deletedAt).toBeNull();

    // Back on, so the rail is live for whatever runs next.
    await baseFeeUpsert(superAdmin, [SPARE_RAIL]);
    const resRestored = await baseFeeFindAll(superAdmin);
    expect(resRestored.data!.find((row) => row.code === code)?.isActive).toBe(
      true,
    );
  });

  it('rejects bad input', async () => {
    // Nothing to apply, and almost certainly a bug in the caller.
    expect(await rejection(baseFeeUpsert(superAdmin, []))).toContain('-> 400');

    // Two entries sharing the natural key would upsert one row twice and let
    // the later one win, with nothing said about it.
    const duplicate = await rejection(
      baseFeeUpsert(superAdmin, [BASE_FEES[0], BASE_FEES[0]]),
    );
    expect(duplicate).toContain('-> 400');
    expect(duplicate).toContain('Duplicate base fee');

    // TELEANJAR is in ProviderNameEnum but is never activated by this suite, so
    // it has no live config.Provider row. The service checks rather than
    // leaving it to the foreign key, which would answer with a P2003 naming
    // neither the value nor the column.
    const unknownProvider = await rejection(
      baseFeeUpsert(superAdmin, [
        like(BASE_FEES[0], { providerName: ProviderNameEnum.TELEANJAR }),
      ]),
    );
    expect(unknownProvider).toContain('-> 422');
    expect(unknownProvider).toContain('[0].providerName');
    expect(unknownProvider).toContain('is not configured');

    // The types a method supports live in PaymentMethod.transactionTypes, an
    // array column with no constraint relating the two - so without this check
    // a QRIS withdrawal inserts happily and then never matches a transaction
    // for the rest of its life.
    const wrongType = await rejection(
      baseFeeUpsert(superAdmin, [
        like(BASE_FEES[0], {
          paymentMethodName: PaymentMethodNameEnum.QRIS,
          transactionType: TransactionTypeEnum.WITHDRAW,
        }),
      ]),
    );
    expect(wrongType).toContain('-> 422');
    expect(wrongType).toContain('[0].transactionType');
    expect(wrongType).toContain('QRIS supports PURCHASE, not WITHDRAW');

    // isActive as a string, and omitted. Both were accepted silently before
    // @IsBoolean() was added: `whitelist: true` strips any property carrying no
    // class-validator decorator, so the field never reached the service and a
    // fee could not be switched off at all.
    const withoutIsActive: Record<string, unknown> = { ...BASE_FEES[0] };
    delete withoutIsActive.isActive;
    expect(
      await rejection(
        baseFeeUpsert(superAdmin, [
          withoutIsActive as unknown as UpsertBaseFeeDto,
        ]),
      ),
    ).toContain('-> 422');
    expect(
      await rejection(
        baseFeeUpsert(superAdmin, [
          { ...BASE_FEES[0], isActive: 'true' } as unknown as UpsertBaseFeeDto,
        ]),
      ),
    ).toContain('-> 422');

    // Money is Decimal(15, 2) and a third decimal place would be rounded away
    // by Postgres rather than refused.
    expect(
      await rejection(
        baseFeeUpsert(superAdmin, [
          like(BASE_FEES[0], { feeProviderFixed: '1200.555' }),
        ]),
      ),
    ).toContain('-> 422');

    // Percentages are capped at 100 by the business rule, not by the column.
    expect(
      await rejection(
        baseFeeUpsert(superAdmin, [
          like(BASE_FEES[0], { feeProviderPercentage: '101' }),
        ]),
      ),
    ).toContain('-> 422');

    // None of the refusals above may have written anything.
    const res = await baseFeeFindAll(superAdmin);
    const codes = res.data!.map((row) => row.code);
    expect(codes).not.toContainEqual('TELEANJAR_QRIS_PURCHASE');
    expect(codes).not.toContainEqual('MOTIONPAY_QRIS_WITHDRAW');
  });

  it('is super admin only', async () => {
    // RolesGuard is registered and the controller carries
    // @Roles(ROLE.SUPER_ADMIN), so agentinternal is refused here.
    expect(await rejection(baseFeeUpsert(agentInternal, BASE_FEES))).toContain(
      '-> 403',
    );
    expect(await rejection(baseFeeFindAll(agentInternal))).toContain('-> 403');

    // The operational read is a different endpoint on purpose and carries only
    // @CheckPolicies(), which enforces nothing yet - so the same principal gets
    // through there. That asymmetry is the reason both endpoints exist.
    const resConfig = await feeConfigFindAll(agentInternal);
    expect(resConfig.statusCode).toEqual(HttpStatus.OK);
    expect(resConfig.data).toBeTruthy();
  });
});
