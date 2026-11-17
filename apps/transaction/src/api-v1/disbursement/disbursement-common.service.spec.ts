import { TransactionStatusEnum } from '@app/microservice';
import {
  BalanceBucketEnum,
  BalanceDirectionEnum,
  BalanceHolderTypeEnum,
  BalanceMovement,
  BalanceReasonEnum,
  BalanceSourceTypeEnum,
} from '@app/balance';
import { METADATA_KEY } from '@app/upstream';
import Decimal from 'decimal.js';
import { DisbursementCommonService } from './disbursement-common.service';

/**
 * The generated Prisma client cannot be loaded here, and that is why this
 * service had no tests.
 *
 * `apps/transaction/src/generated/prisma/client.ts` is generated with
 * `moduleFormat = "esm"` and reads `import.meta.url` at module scope, which
 * ts-jest's CommonJS output cannot evaluate - and `@transaction/prisma` is a
 * `tsconfig` path alias that the root jest config has no mapper for either, so
 * it does not even resolve. A virtual mock answers both problems in the one
 * place that needs it, rather than adding a mapper to the shared config that
 * would try to load 1.5MB of generated ESM into every suite.
 *
 * Only `Prisma` has to be here. `PrismaClient` is imported by the service as a
 * constructor parameter type and nothing else, so TypeScript elides it from the
 * emitted `require`; `Prisma` survives because `reserveFailure` does an
 * `instanceof Prisma.PrismaClientKnownRequestError`.
 *
 * It sits below the imports and still runs before them: ts-jest hoists
 * `jest.mock` above the emitted `require` calls, which is the whole reason the
 * call is allowed to read as though it came after.
 */
jest.mock(
  '@transaction/prisma',
  () => ({
    Prisma: {
      PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
        constructor(
          message: string,
          readonly code: string,
        ) {
          super(message);
        }
      },
    },
  }),
  { virtual: true },
);

/**
 * `markFailed` wrote the status and nothing else, so a payout that died at
 * create left its whole `netNominal` stranded in the merchant's RESERVED
 * bucket, permanently. Nothing caught it: `buildPayoutFailed` existed and was
 * correct, the reservation's own two entries agreed with the snapshot, and the
 * nightly entries-vs-snapshot check therefore passed on a row whose money had
 * nowhere to go.
 *
 * These are the first tests for this service. They cover `markFailed` only -
 * the release, the atomicity and the guard - because that is the method the
 * defect lived in and the one a future refactor is most likely to split back
 * apart.
 */
describe('DisbursementCommonService.markFailed', () => {
  const DISBURSEMENT_ID = 7;
  const MERCHANT_ID = 29;
  const NET_NOMINAL = new Decimal('76777.00');

  let updateMany: jest.Mock;
  let findUniqueOrThrow: jest.Mock;
  let post: jest.Mock;
  /** The object handed to the `$transaction` callback. */
  let tx: unknown;
  let service: DisbursementCommonService;

  beforeEach(() => {
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    findUniqueOrThrow = jest.fn().mockResolvedValue({
      merchantId: MERCHANT_ID,
      netNominal: NET_NOMINAL,
    });
    post = jest.fn().mockResolvedValue(undefined);

    tx = { disbursementTransaction: { updateMany, findUniqueOrThrow } };

    const prismaMaster = {
      $transaction: jest.fn(
        async (run: (client: unknown) => Promise<unknown>) => run(tx),
      ),
    };

    service = new DisbursementCommonService(
      prismaMaster as never,
      undefined as never,
      undefined as never,
      { post } as never,
      undefined as never,
      undefined as never,
    );
  });

  const markFailed = () =>
    service.markFailed(DISBURSEMENT_ID, {
      [METADATA_KEY.TRANSFER_PAYMENT_ERROR]: { message: 'rejected' },
    });

  const movement = (): BalanceMovement =>
    post.mock.calls[0][1] as BalanceMovement;

  it('gives the reservation back when it marks a payout FAILED', async () => {
    await markFailed();

    expect(post).toHaveBeenCalledTimes(1);
    expect(movement()).toMatchObject({
      reason: BalanceReasonEnum.PAYOUT_FAILED,
      sourceType: BalanceSourceTypeEnum.DISBURSEMENT,
      sourceId: DISBURSEMENT_ID,
    });
  });

  it('moves the exact reserved amount from RESERVED back to AVAILABLE', async () => {
    await markFailed();

    expect(movement().legs).toEqual([
      {
        holderType: BalanceHolderTypeEnum.MERCHANT,
        holderId: MERCHANT_ID,
        amount: NET_NOMINAL,
        bucket: BalanceBucketEnum.RESERVED,
        direction: BalanceDirectionEnum.DEBIT,
      },
      {
        holderType: BalanceHolderTypeEnum.MERCHANT,
        holderId: MERCHANT_ID,
        amount: NET_NOMINAL,
        bucket: BalanceBucketEnum.AVAILABLE,
        direction: BalanceDirectionEnum.CREDIT,
      },
    ]);
  });

  /**
   * The failure path earns nobody anything, so a fee leg here would credit an
   * internal or agent holder for a payout that never happened - and the
   * reservation would no longer net to zero for the merchant.
   */
  it('credits nobody but the merchant', async () => {
    await markFailed();

    expect(movement().legs).toHaveLength(2);
    expect(
      movement().legs.every(
        (leg) => leg.holderType === BalanceHolderTypeEnum.MERCHANT,
      ),
    ).toBe(true);
  });

  it('writes the status and the release on the same transaction client', async () => {
    await markFailed();

    expect(updateMany.mock.instances).toBeDefined();
    expect(post).toHaveBeenCalledWith(tx, expect.anything());
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: DISBURSEMENT_ID,
        status: TransactionStatusEnum.PENDING,
      },
      data: expect.objectContaining({
        status: TransactionStatusEnum.FAILED,
      }),
    });
  });

  /**
   * The transition out of PENDING is what authorises the release. A second
   * failure on the same row, or a callback that raced it, moves no row and must
   * therefore move no money - otherwise the reservation is handed back twice
   * and the merchant can spend it twice.
   */
  it('releases nothing when the row was already out of PENDING', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await markFailed();

    expect(post).not.toHaveBeenCalled();
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });

  /**
   * The caller is on an error path with a merchant-facing exception already
   * chosen, so a throw from here would replace a precise 502 with a 500. The
   * rolled-back transaction leaves the row PENDING with its reservation held,
   * which is the recoverable state.
   */
  it('swallows a failed release rather than replacing the caller error', async () => {
    post.mockRejectedValue(new Error('balance post exploded'));

    await expect(markFailed()).resolves.toBeUndefined();
  });

  /**
   * `netNominal` has to be the figure `reserve()` actually credited to
   * RESERVED. Reading it back from the row rather than recomputing it from the
   * fee details is what keeps the bucket empty afterwards.
   */
  it('reads the reserved amount from the row, inside the transaction', async () => {
    await markFailed();

    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: DISBURSEMENT_ID },
      select: { merchantId: true, netNominal: true },
    });
  });
});
