import Decimal from 'decimal.js';
import { UpstreamTransactionStatusEnum } from './upstream.enum';

/**
 * Normalized result of creating a pay-in (purchase) at any upstream provider.
 *
 * The point of this shape is that the business layer never sees a provider's
 * wire format. Adding a second provider should mean writing a new mapper into
 * this type, not touching the purchase flow.
 *
 * Plain TypeScript rather than TypeBox on purpose: this is an in-process
 * result, not data arriving from outside, so there is nothing to validate at
 * runtime. If it ever crosses a TCP boundary it needs a TypeBox schema like the
 * DTOs in `libs/microservice`.
 */
export interface UpstreamPurchaseResult {
  /** Our own transaction correlation code, echoed back for matching. */
  code: string;
  /** The provider's identifier for this transaction; needed for status lookups. */
  externalId: string;
  status: UpstreamTransactionStatusEnum;
  nominal: Decimal;
  /** Payload to render for the customer — for QRIS, the QR string. */
  content: string;
  /** Provider-supplied human-readable status description. */
  message: string;
  /** Raw provider payload, persisted as transaction metadata. */
  metadata: Record<string, unknown>;
}

/**
 * Normalized result of a status lookup at any upstream provider.
 *
 * Settlement details are optional because providers only populate them once a
 * payment actually completes — MotionPay returns empty strings for all of them
 * while a transaction is pending.
 */
export interface UpstreamPurchaseStatusResult {
  code: string;
  externalId: string;
  status: UpstreamTransactionStatusEnum;
  nominal: Decimal;
  message: string;
  /** Retrieval Reference Number — only present once paid. */
  rrn?: string;
  /** Raw provider timestamp string; not parsed here, formats vary by provider. */
  paidAt?: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
}
