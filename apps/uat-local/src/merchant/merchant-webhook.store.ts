import { Injectable } from '@nestjs/common';

export const WEBHOOK_KIND = {
  PAYIN: 'PAYIN',
  PAYOUT: 'PAYOUT',
} as const;
export type WebhookKind = (typeof WEBHOOK_KIND)[keyof typeof WEBHOOK_KIND];

export interface ReceivedWebhook {
  readonly kind: WebhookKind;
  /** Our clock, not theirs - this is the receipt, not the notification. */
  readonly receivedAt: string;
  /** Pulled out for readability; `body` is the truth. */
  readonly transactionId: string | null;
  readonly merchantReference: string | null;
  readonly status: string | null;
  /** Exactly what arrived, unvalidated. */
  readonly body: unknown;
}

/**
 * Ring buffer bound. A run is meant to be watchable over a lunch break, which
 * is a few hundred transactions; past that the oldest receipts are the least
 * interesting thing in the process.
 */
const MAX_RECEIPTS = 500;

/**
 * What the fake merchant remembers about being notified.
 *
 * The build order asks this step to "log the payload, count it, return 200".
 * The count lives here rather than in a log line because a number a spec can
 * read is worth more than one a human has to find: Sighting 6 is "within ten
 * seconds of a purchase, in this order…", and that is an assertion if the
 * receipts are addressable and an eyeballing exercise if they are not.
 *
 * In memory, for the same reason `ProviderStore` is: a fake merchant writing
 * into our tables stops being a fake merchant.
 */
@Injectable()
export class MerchantWebhookStore {
  private readonly receipts: ReceivedWebhook[] = [];
  private readonly counts = new Map<WebhookKind, number>();

  record(kind: WebhookKind, body: unknown): ReceivedWebhook {
    const receipt: ReceivedWebhook = {
      kind,
      receivedAt: new Date().toISOString(),
      transactionId: readString(body, 'transactionId'),
      merchantReference: readString(body, 'merchantReference'),
      status: readString(body, 'status'),
      body,
    };

    this.receipts.push(receipt);
    if (this.receipts.length > MAX_RECEIPTS) this.receipts.shift();

    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);

    return receipt;
  }

  /** Lifetime count, which outlives the ring buffer on purpose. */
  countOf(kind: WebhookKind): number {
    return this.counts.get(kind) ?? 0;
  }

  /** Newest last, as they arrived - order is the whole point for a duplicate. */
  recent(limit = MAX_RECEIPTS): ReceivedWebhook[] {
    return this.receipts.slice(-limit);
  }

  /**
   * Every receipt for one transaction, in arrival order.
   *
   * Returns a list rather than one receipt because arriving twice is a case
   * the switchboard produces deliberately, and a lookup that could only hold
   * one would hide exactly the scenario it was asked to prove.
   */
  byMerchantReference(merchantReference: string): ReceivedWebhook[] {
    return this.receipts.filter(
      (receipt) => receipt.merchantReference === merchantReference,
    );
  }
}

function readString(body: unknown, key: string): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
