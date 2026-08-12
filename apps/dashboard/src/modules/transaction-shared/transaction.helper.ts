import Decimal from 'decimal.js';
import { DateHelper } from '../../shared/helper';
import { TransactionFeeDetailDto } from './dto/transaction-fee-detail.dto';

/** Listings default to the last 7 days when no range is given. */
export const DEFAULT_RANGE_DAYS = 7;

/**
 * Widens the requested range to whole days in the configured timezone, so
 * "from 2026-08-01" includes that entire Jakarta day rather than starting at
 * midnight UTC - which would be 07:00 local and silently drop the morning.
 */
export function resolveDateRange(
  from?: Date | null,
  to?: Date | null,
): { gte: Date; lte: Date } {
  const fromDateTime = from
    ? DateHelper.fromJsDate(from)!
    : DateHelper.now().minus({ days: DEFAULT_RANGE_DAYS });

  const toDateTime = to ? DateHelper.fromJsDate(to)! : DateHelper.now();

  return {
    gte: fromDateTime.startOf('day').toJSDate(),
    lte: toDateTime.endOf('day').toJSDate(),
  };
}

type FeeDetailRow = {
  id: number;
  agentId: number | null;
  type: TransactionFeeDetailDto['type'];
  nominal: unknown;
  feeFixed: unknown;
  feePercentage: unknown;
};

/**
 * Maps fee rows to DTOs and totals them.
 *
 * Summed with Decimal rather than floats - these are the amounts deducted from
 * a merchant's payout, so drift is not acceptable.
 */
export function mapFeeDetails(rows: FeeDetailRow[]): {
  feeDetails: TransactionFeeDetailDto[];
  totalFeeCut: string;
} {
  let total = new Decimal(0);
  const feeDetails: TransactionFeeDetailDto[] = [];

  for (const row of rows) {
    total = total.plus(new Decimal(String(row.nominal)));
    feeDetails.push(new TransactionFeeDetailDto(row as never));
  }

  return { feeDetails, totalFeeCut: total.toFixed(2) };
}
