import Decimal from 'decimal.js';
import {
  BalanceBucketEnum,
  BalanceDirectionEnum,
  BalanceHolderTypeEnum,
  BalanceReasonEnum,
  BalanceSourceTypeEnum,
} from './balance.enum';

/** One side of a movement: one holder, one bucket, one direction. */
export type BalanceLeg = {
  holderId: number;
  holderType: BalanceHolderTypeEnum;
  bucket: BalanceBucketEnum;
  direction: BalanceDirectionEnum;
  /** Always positive. `direction` carries the sign. */
  amount: Decimal;
};

/**
 * One indivisible act, as data.
 *
 * This is the journal entry of the design - `post()` is what turns it into
 * ledger rows. It is never persisted as a row of its own, because it does not
 * need to be: every leg of one movement carries the same `reason`, `sourceType`
 * and `sourceId`, so "what moved together" is always one query away. A journal
 * table would restate what those three columns already say.
 *
 * Keeping it declarative means the whole catalogue of movements reads in one
 * screen and unit-tests without a database.
 */
export type BalanceMovement = {
  reason: BalanceReasonEnum;
  sourceType: BalanceSourceTypeEnum;
  sourceId: number;
  batchId?: number;
  /**
   * Required, and passed explicitly rather than stamped by the audit extension.
   * `BalanceEntry.createdBy` is NOT NULL, so TypeScript refuses an
   * unattributed movement at the call site - see balance.type.ts.
   */
  createdBy: number;
  legs: BalanceLeg[];
};

/** Identifies a snapshot row: one per holder per bucket. */
export const snapshotKey = (leg: {
  holderType: BalanceHolderTypeEnum;
  holderId: number;
  bucket: BalanceBucketEnum;
}): string => `${leg.holderType}:${leg.holderId}:${leg.bucket}`;

/** Identifies a holder, across buckets - what the zero-sum check groups by. */
export const holderKey = (leg: {
  holderType: BalanceHolderTypeEnum;
  holderId: number;
}): string => `${leg.holderType}:${leg.holderId}`;
