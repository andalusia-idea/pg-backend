/**
 * Raised when an upstream provider call fails: transport error, non-OK
 * envelope, or a response whose shape does not match what we validated for.
 *
 * `context` carries the raw provider payload so the caller can persist it as
 * transaction metadata without the provider-specific shape leaking into the
 * business layer.
 */
export class UpstreamException extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'UpstreamException';
  }
}

/**
 * Whether an error means "we could not complete the call" rather than "the call
 * completed and the answer was no".
 *
 * Lives here rather than in a business service because the distinction is a
 * property of the provider call: both the upstream layer deciding whether a
 * payout's outcome is unknown, and the business layer deciding between a
 * retryable 503 and a 4xx the merchant must not repeat, need the same answer.
 * Two copies of this would eventually disagree about one error code, and the
 * disagreement would show up as a payout marked FAILED that actually went out.
 */
export function isUpstreamTransportFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    name?: string;
    code?: string;
    context?: { status?: number };
  };

  if (candidate.name === 'TimeoutError') return true;
  if (
    candidate.code === 'ECONNABORTED' ||
    candidate.code === 'ETIMEDOUT' ||
    candidate.code === 'ECONNREFUSED'
  ) {
    return true;
  }

  // An UpstreamException with no HTTP status means the request never got an
  // answer; one carrying a status means the provider replied and refused.
  if (error instanceof UpstreamException) {
    return candidate.context?.status === undefined;
  }

  return false;
}

/**
 * The destination as the provider confirmed it, for a payout that then failed.
 *
 * Deliberately three fields and not a normalised inquiry response. Each
 * provider's inquiry returns its own wire shape - there is no shared inquiry
 * DTO any more - and the only thing a caller does with it after a failure is
 * write the confirmed destination onto the row. Carrying the whole raw payload
 * here would make the exception provider-specific; carrying nothing would lose
 * the one part that matters.
 *
 * The raw payload is not lost: it belongs in `context`, which is persisted as
 * transaction metadata.
 */
export type UpstreamTransferBeneficiary = {
  accountHolderName: string;
  accountNumber: string;
  bankCode: string;
};

/** Which leg of a two-call payout was in flight when it failed. */
export const UpstreamTransferStep = {
  INQUIRY: 'inquiry',
  PAYMENT: 'payment',
} as const;
export type UpstreamTransferStep =
  (typeof UpstreamTransferStep)[keyof typeof UpstreamTransferStep];

/**
 * A payout that failed partway through the provider's two-call sequence.
 *
 * The upstream layer owns the orchestration, so only it knows which leg was in
 * flight - and the caller's response differs completely by leg:
 *
 * - **`inquiry`** - nothing moved. Safe to mark the payout FAILED.
 * - **`payment` with `outcomeUnknown`** - the call never got an answer, so the
 *   money may well have left. Marking it FAILED would tell the merchant their
 *   payout did not happen while the recipient is holding it. It has to stay
 *   PENDING for the status poll.
 * - **`payment` without `outcomeUnknown`** - the provider answered and refused.
 *   Safe to mark FAILED.
 *
 * `beneficiary` is set when the inquiry leg had already succeeded, so the caller
 * can still record the provider-confirmed destination on a payout that then
 * failed - otherwise the row keeps the merchant's unverified values on exactly
 * the payouts someone later has to explain.
 */
export class UpstreamTransferException extends UpstreamException {
  readonly step: UpstreamTransferStep;
  readonly outcomeUnknown: boolean;
  readonly beneficiary: UpstreamTransferBeneficiary | null;

  constructor(params: {
    provider: string;
    message: string;
    step: UpstreamTransferStep;
    outcomeUnknown: boolean;
    beneficiary?: UpstreamTransferBeneficiary | null;
    context?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(params.provider, params.message, {
      step: params.step,
      outcomeUnknown: params.outcomeUnknown,
      ...params.context,
    });
    this.name = 'UpstreamTransferException';
    this.step = params.step;
    this.outcomeUnknown = params.outcomeUnknown;
    this.beneficiary = params.beneficiary ?? null;
    if (params.cause !== undefined) this.cause = params.cause;
  }
}
