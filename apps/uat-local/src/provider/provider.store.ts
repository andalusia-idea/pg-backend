import { Injectable } from '@nestjs/common';
import { SCENARIO, Scenario } from './scenario';

export const RAIL = {
  PURCHASE: 'PURCHASE',
  DISBURSEMENT: 'DISBURSEMENT',
} as const;
export type Rail = (typeof RAIL)[keyof typeof RAIL];

export const PROVIDER = {
  JATELINDO: 'JATELINDO',
  MOTIONPAY: 'MOTIONPAY',
} as const;
export type Provider = (typeof PROVIDER)[keyof typeof PROVIDER];

/**
 * Our own vocabulary, not the providers'.
 *
 * Each payload builder translates this into its provider's wire codes - the
 * same translation the real callback services perform in the opposite
 * direction. Keeping the fake's internal state in neutral terms is what lets
 * one store serve two providers whose status vocabularies share nothing.
 */
export const OUTCOME = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
} as const;
export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];

export interface FakeTransaction {
  readonly provider: Provider;
  readonly rail: Rail;
  /** Our reference, as the provider received it: traceNumber / external_id. */
  readonly systemReference: string;
  /** Theirs, which we invent: jpaReferenceNo / transaction_id. */
  readonly providerReference: string;
  readonly amount: number;
  readonly scenario: Scenario;
  readonly createdAt: number;

  /* Mutable delivery state. */
  /** Outcomes still to send, in order. Empty = nothing more will arrive. */
  pending: Outcome[];
  /** Epoch ms; the dispatcher ignores this row until then. */
  deliverAt: number;
  /** Failed POST attempts for the head of `pending`. */
  attempts: number;
}

/**
 * How many callbacks each scenario produces, and in what order.
 *
 * One queue per transaction covers duplicate, out-of-order and never-delivers
 * without a branch for each: they are only different queues. An empty queue is
 * the honest representation of "nothing more will ever arrive", which is a
 * state the real world produces and the one worth watching.
 */
const DELIVERY_PLAN: Readonly<Record<Scenario, readonly Outcome[]>> = {
  [SCENARIO.SUCCESS]: [OUTCOME.SUCCESS],
  [SCENARIO.FAILED_BY_CALLBACK]: [OUTCOME.FAILED],
  [SCENARIO.EXPIRED]: [OUTCOME.EXPIRED],
  [SCENARIO.DUPLICATE_CALLBACK]: [OUTCOME.SUCCESS, OUTCOME.SUCCESS],
  [SCENARIO.OUT_OF_ORDER]: [OUTCOME.FAILED, OUTCOME.SUCCESS],
  [SCENARIO.UNKNOWN_REFERENCE]: [OUTCOME.SUCCESS],
  [SCENARIO.NEVER_DELIVERS]: [],
  /* Rejected or broken at create time: there is nothing to report later. */
  [SCENARIO.REJECTED_AT_CREATE]: [],
  [SCENARIO.CREATE_500]: [],
  /* The dangerous one: the client gave up, but the transaction still succeeds. */
  [SCENARIO.CREATE_TIMEOUT]: [OUTCOME.SUCCESS],
};

type NewTransaction = Omit<
  FakeTransaction,
  'pending' | 'deliverAt' | 'attempts' | 'createdAt'
>;

/**
 * Everything the fake provider remembers, which is one map.
 *
 * **In memory on purpose.** The store dies with the process, which is honest:
 * a fresh `test-db-all` run wants a fresh provider too. If a restart ever
 * needs to survive, give `uat-local` its own schema rather than borrowing one
 * of ours - a fake provider writing into our tables stops being a fake
 * provider.
 */
@Injectable()
export class ProviderStore {
  private readonly rows = new Map<string, FakeTransaction>();

  accept(input: NewTransaction): FakeTransaction {
    const row: FakeTransaction = {
      ...input,
      createdAt: Date.now(),
      pending: [...DELIVERY_PLAN[input.scenario]],
      deliverAt: Date.now() + randomDelayMs(),
      attempts: 0,
    };
    this.rows.set(row.providerReference, row);
    return row;
  }

  byProviderReference(reference: string): FakeTransaction | undefined {
    return this.rows.get(reference);
  }

  /** Rows with something to deliver whose delay has elapsed. */
  due(now = Date.now()): FakeTransaction[] {
    return [...this.rows.values()].filter(
      (row) => row.pending.length > 0 && row.deliverAt <= now,
    );
  }

  /** Everything, newest last. For the status route and for eyeballing state. */
  all(): FakeTransaction[] {
    return [...this.rows.values()];
  }

  forget(reference: string): void {
    this.rows.delete(reference);
  }
}

/**
 * 2-10s. Long enough that PENDING is visible in the dashboard, short enough to
 * watch a few hundred transactions over a lunch break.
 */
function randomDelayMs(): number {
  return (2 + Math.floor(Math.random() * 9)) * 1_000;
}
