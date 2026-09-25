import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import Decimal from 'decimal.js';
import { INTERNAL_HOLDER_ID } from './balance.constant';
import {
  BalanceBucketEnum,
  BalanceDirectionEnum,
  BalanceHolderTypeEnum,
  BalanceReasonEnum,
  BalanceSourceTypeEnum,
} from './balance.enum';
import { BalanceLeg, BalanceMovement } from './balance.movement';
import { BalanceService } from './balance.service';
import type { BalanceTx } from './balance.type';

const MERCHANT_ID = 27;
const AGENT_ID = 5;
const CREATED_BY = 91;

const leg = (
  holderType: BalanceHolderTypeEnum,
  holderId: number,
  bucket: BalanceBucketEnum,
  direction: BalanceDirectionEnum,
  amount: string,
): BalanceLeg => ({
  holderType,
  holderId,
  bucket,
  direction,
  amount: new Decimal(amount),
});

const movement = (over: Partial<BalanceMovement> = {}): BalanceMovement => ({
  reason: BalanceReasonEnum.PAYIN_CAPTURED,
  sourceType: BalanceSourceTypeEnum.PURCHASE,
  sourceId: 123,
  createdBy: CREATED_BY,
  legs: [
    leg(
      BalanceHolderTypeEnum.MERCHANT,
      MERCHANT_ID,
      BalanceBucketEnum.PENDING,
      BalanceDirectionEnum.CREDIT,
      '98000.00',
    ),
  ],
  ...over,
});

/** The signed snapshot amount sits at parameter 4 of the upsert template. */
const SIGNED_AMOUNT_ARG = 4;

describe('BalanceService', () => {
  let createManyAndReturn: jest.Mock;
  let executeRaw: jest.Mock;
  let queryRaw: jest.Mock;
  let tx: BalanceTx;
  let service: BalanceService;

  beforeEach(() => {
    createManyAndReturn = jest.fn(
      async ({
        data,
      }: {
        data: {
          holderType: BalanceHolderTypeEnum;
          holderId: number;
          bucket: BalanceBucketEnum;
        }[];
      }) =>
        data.map((row, index) => ({
          id: BigInt(100 + index),
          holderType: row.holderType,
          holderId: row.holderId,
          bucket: row.bucket,
        })),
    );
    executeRaw = jest.fn(async () => 1);
    queryRaw = jest.fn(async () => [{ ok: 1 }]);

    tx = {
      balanceEntry: { createManyAndReturn },
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
    } as never;

    service = new BalanceService();
  });

  describe('post', () => {
    it('writes one entry per leg, attributed to the caller', async () => {
      await service.post(tx, movement());

      const [args] = createManyAndReturn.mock.calls[0] as [
        { data: { createdBy: number; amount: string; sourceId: number }[] },
      ];
      expect(args.data).toHaveLength(1);
      expect(args.data[0].createdBy).toBe(CREATED_BY);
      expect(args.data[0].amount).toBe('98000.00');
      expect(args.data[0].sourceId).toBe(123);
    });

    /**
     * The deadlock discipline. Two transactions touching the same snapshot rows
     * in different orders can deadlock on Postgres row locks, so every movement
     * is sorted the same way before anything is written.
     */
    it('applies legs in a deterministic order regardless of input order', async () => {
      await service.post(
        tx,
        movement({
          legs: [
            leg(
              BalanceHolderTypeEnum.INTERNAL,
              INTERNAL_HOLDER_ID,
              BalanceBucketEnum.PENDING,
              BalanceDirectionEnum.CREDIT,
              '1000.00',
            ),
            leg(
              BalanceHolderTypeEnum.AGENT,
              AGENT_ID,
              BalanceBucketEnum.PENDING,
              BalanceDirectionEnum.CREDIT,
              '200.00',
            ),
            leg(
              BalanceHolderTypeEnum.MERCHANT,
              MERCHANT_ID,
              BalanceBucketEnum.PENDING,
              BalanceDirectionEnum.CREDIT,
              '98000.00',
            ),
          ],
        }),
      );

      const [args] = createManyAndReturn.mock.calls[0] as [
        { data: { holderType: BalanceHolderTypeEnum }[] },
      ];
      expect(args.data.map((row) => row.holderType)).toEqual([
        BalanceHolderTypeEnum.MERCHANT,
        BalanceHolderTypeEnum.INTERNAL,
        BalanceHolderTypeEnum.AGENT,
      ]);
    });

    it('folds every leg into the snapshot', async () => {
      await service.post(
        tx,
        movement({
          reason: BalanceReasonEnum.MERCHANT_SETTLED,
          legs: [
            leg(
              BalanceHolderTypeEnum.MERCHANT,
              MERCHANT_ID,
              BalanceBucketEnum.PENDING,
              BalanceDirectionEnum.DEBIT,
              '98000.00',
            ),
            leg(
              BalanceHolderTypeEnum.MERCHANT,
              MERCHANT_ID,
              BalanceBucketEnum.AVAILABLE,
              BalanceDirectionEnum.CREDIT,
              '98000.00',
            ),
          ],
        }),
      );

      expect(executeRaw).toHaveBeenCalledTimes(2);
    });

    it('signs the snapshot delta by direction, never by the amount', async () => {
      await service.post(
        tx,
        movement({
          reason: BalanceReasonEnum.PAYOUT_COMPLETED,
          sourceType: BalanceSourceTypeEnum.DISBURSEMENT,
          legs: [
            leg(
              BalanceHolderTypeEnum.MERCHANT,
              MERCHANT_ID,
              BalanceBucketEnum.RESERVED,
              BalanceDirectionEnum.DEBIT,
              '30000.00',
            ),
          ],
        }),
      );

      expect(executeRaw.mock.calls[0][SIGNED_AMOUNT_ARG]).toBe('-30000.00');
    });

    it('rejects a transfer whose legs do not net to zero for a holder', async () => {
      await expect(
        service.post(
          tx,
          movement({
            reason: BalanceReasonEnum.MERCHANT_SETTLED,
            legs: [
              leg(
                BalanceHolderTypeEnum.MERCHANT,
                MERCHANT_ID,
                BalanceBucketEnum.PENDING,
                BalanceDirectionEnum.DEBIT,
                '98000.00',
              ),
              leg(
                BalanceHolderTypeEnum.MERCHANT,
                MERCHANT_ID,
                BalanceBucketEnum.AVAILABLE,
                BalanceDirectionEnum.CREDIT,
                '98000.01',
              ),
            ],
          }),
        ),
      ).rejects.toThrow(/net to zero/);

      expect(createManyAndReturn).not.toHaveBeenCalled();
    });

    it('allows a non-transfer reason to change a holder total', async () => {
      await expect(
        service.post(
          tx,
          movement({ reason: BalanceReasonEnum.PAYIN_CAPTURED }),
        ),
      ).resolves.toBeUndefined();
    });

    it('rejects two legs for one snapshot row rather than colliding on the unique key', async () => {
      await expect(
        service.post(
          tx,
          movement({
            legs: [
              leg(
                BalanceHolderTypeEnum.MERCHANT,
                MERCHANT_ID,
                BalanceBucketEnum.PENDING,
                BalanceDirectionEnum.CREDIT,
                '1.00',
              ),
              leg(
                BalanceHolderTypeEnum.MERCHANT,
                MERCHANT_ID,
                BalanceBucketEnum.PENDING,
                BalanceDirectionEnum.CREDIT,
                '2.00',
              ),
            ],
          }),
        ),
      ).rejects.toThrow(/two legs for/);
    });

    it.each([['0.00'], ['-5.00']])(
      'rejects a non-positive amount (%s)',
      async (amount) => {
        await expect(
          service.post(
            tx,
            movement({
              legs: [
                leg(
                  BalanceHolderTypeEnum.MERCHANT,
                  MERCHANT_ID,
                  BalanceBucketEnum.PENDING,
                  BalanceDirectionEnum.CREDIT,
                  amount,
                ),
              ],
            }),
          ),
        ).rejects.toThrow(/positive amount/);
      },
    );

    /**
     * Silently rounding here would bury a fee-split bug in the ledger. The
     * residual belongs to whoever computes the split.
     */
    it('rejects an amount finer than the column stores', async () => {
      await expect(
        service.post(
          tx,
          movement({
            legs: [
              leg(
                BalanceHolderTypeEnum.MERCHANT,
                MERCHANT_ID,
                BalanceBucketEnum.PENDING,
                BalanceDirectionEnum.CREDIT,
                '100.005',
              ),
            ],
          }),
        ),
      ).rejects.toThrow(/decimal places/);
    });

    it('rejects an empty movement', async () => {
      await expect(service.post(tx, movement({ legs: [] }))).rejects.toThrow(
        /no legs/,
      );
    });

    /**
     * A root client would let the entries and the snapshot commit separately,
     * which is the one failure this whole design exists to prevent - and it
     * would do it silently.
     */
    it('refuses a root client', async () => {
      const rootClient = { ...tx, $transaction: jest.fn() } as never;

      await expect(service.post(rootClient, movement())).rejects.toThrow(
        /\$transaction/,
      );
      expect(createManyAndReturn).not.toHaveBeenCalled();
    });
  });

  describe('reserve', () => {
    const params = {
      holderType: BalanceHolderTypeEnum.MERCHANT,
      holderId: MERCHANT_ID,
      amount: new Decimal('30000.00'),
      sourceType: BalanceSourceTypeEnum.DISBURSEMENT,
      sourceId: 77,
      createdBy: CREATED_BY,
    };

    it('moves the amount from AVAILABLE to RESERVED when the balance covers it', async () => {
      const result = await service.reserve(tx, params);

      expect(result).toEqual({ ok: true });

      const [args] = createManyAndReturn.mock.calls[0] as [
        { data: { bucket: BalanceBucketEnum; direction: string }[] },
      ];
      expect(args.data).toHaveLength(2);
      expect(args.data.map((row) => `${row.bucket}:${row.direction}`)).toEqual([
        'AVAILABLE:DEBIT',
        'RESERVED:CREDIT',
      ]);
    });

    /**
     * The lock query returning nothing covers both "not enough" and "this
     * holder has no snapshot row yet" - the same answer either way.
     */
    it('reports insufficient balance and writes nothing when the lock query finds no row', async () => {
      queryRaw.mockImplementation(async () => []);

      const result = await service.reserve(tx, params);

      expect(result).toEqual({ ok: false, reason: 'INSUFFICIENT_BALANCE' });
      expect(createManyAndReturn).not.toHaveBeenCalled();
      expect(executeRaw).not.toHaveBeenCalled();
    });

    it('checks and locks in one statement, before writing anything', async () => {
      await service.reserve(tx, params);

      expect(queryRaw).toHaveBeenCalledTimes(1);
      const sql = (queryRaw.mock.calls[0][0] as string[]).join('?');
      expect(sql).toContain('FOR UPDATE');
      expect(sql).toContain('>=');
    });

    it('rejects a non-positive reservation', async () => {
      await expect(
        service.reserve(tx, { ...params, amount: new Decimal(0) }),
      ).rejects.toThrow(/positive amount/);
      expect(queryRaw).not.toHaveBeenCalled();
    });

    it('refuses a root client', async () => {
      const rootClient = { ...tx, $transaction: jest.fn() } as never;

      await expect(service.reserve(rootClient, params)).rejects.toThrow(
        /\$transaction/,
      );
    });
  });
});
