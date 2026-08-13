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
