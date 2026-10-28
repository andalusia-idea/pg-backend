import {
  BalanceBucketEnum,
  BalanceHolderTypeEnum,
  snapshotKey,
} from '@app/balance';
import { PRISMA_MASTER_PROVIDER_KEY } from '@app/prisma';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, PrismaClient } from '@transaction/prisma';

/**
 * One snapshot whose stored total disagrees with its own entries.
 *
 * The query's `HAVING` clause means this type only ever holds mismatches, so an
 * empty array is the all-clear.
 *
 * `Prisma.Decimal`, not `decimal.js` - a raw query returns Prisma's own Decimal
 * class. The two share the decimal.js API, so `decimal.js` would work by
 * accident, but `instanceof` across them is false and the annotation would be
 * claiming something untrue.
 */
type SnapshotMismatch = {
  holderType: BalanceHolderTypeEnum;
  holderId: number;
  bucket: BalanceBucketEnum;
  /** What the snapshot claims. */
  stored: Prisma.Decimal;
  /** What the entries up to `lastEntryId` actually add up to. */
  computed: Prisma.Decimal;
};

@Injectable()
export class BalanceVerificationService {
  private readonly logger = new Logger(BalanceVerificationService.name);

  constructor(
    @Inject(PRISMA_MASTER_PROVIDER_KEY)
    private readonly prismaMaster: PrismaClient,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_5AM, {
    name: 'balance-verification',
    timeZone: 'Asia/Jakarta',
  })
  async verifySnapshots(): Promise<void> {
    this.logger.log('balance-verification started');

    try {
      const mismatches = await this.prismaMaster.$queryRaw<SnapshotMismatch[]>`
    SELECT
      s."holderType" AS "holderType",
      s."holderId" AS "holderId",
      s."bucket" AS "bucket",
      s."amount" AS "stored",
      COALESCE(SUM(CASE WHEN e."direction" = 'CREDIT' THEN e."amount" ELSE -e."amount" END), 0) AS "computed"
    FROM transaction."BalanceSnapshot" s
      LEFT JOIN transaction."BalanceEntry" e
      ON  e."holderType" = s."holderType"
      AND e."holderId" = s."holderId"
      AND e."bucket" = s."bucket"
      AND e."id" <= s."lastEntryId"
    GROUP BY 1,2,3,4
    HAVING s."amount" <> COALESCE(SUM(CASE WHEN e."direction" = 'CREDIT' THEN e."amount" ELSE -e."amount" END), 0)
    `;

      if (mismatches.length === 0)
        this.logger.log('balance-verification ended successfully');
      else
        this.logger.error(
          `balance-verification mismatch [${mismatches.length}]`,
        );

      for (const mismatch of mismatches) {
        // `snapshotKey` takes the three identifying fields structurally, and
        // `mismatch` already carries them.
        this.logger.error(
          `mismatch amount at key:[${snapshotKey(mismatch)}] BalanceEntry [${mismatch.computed.toFixed(2)}] BalanceSnapshot [${mismatch.stored.toFixed(2)}]`,
        );
      }
    } catch (error) {
      this.logger.error({
        msg: 'Failed to verify BalanceSnapshot and BalanceEntry',
        error,
      });
    }
  }
}
