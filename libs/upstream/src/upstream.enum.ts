/**
 * Provider-agnostic transaction status.
 *
 * Mirrors the values of `TransactionStatusEnum` in the transaction app's Prisma
 * schema, but is declared here so that `libs/upstream` does not depend on an
 * app's generated Prisma client. The string values are identical, so the app
 * maps between them explicitly at its own boundary.
 *
 * House style: `as const` object + derived union, not a TS `enum` — these values
 * cross JSON boundaries and a nominal enum would need a cast at every one.
 */
export const UpstreamTransactionStatusEnum = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type UpstreamTransactionStatusEnum =
  (typeof UpstreamTransactionStatusEnum)[keyof typeof UpstreamTransactionStatusEnum];
