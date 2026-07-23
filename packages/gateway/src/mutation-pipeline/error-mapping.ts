/**
 * Canonical-error mapping — roadmap/16-gateway-core.md §In scope,
 * "Mutation pipeline": "canonical-error mapping (provider bodies never
 * leak)." Work item 4. The one call site any HTTP-transport failure
 * passes through on its way into `@eo/contracts`'s 10-member
 * `ConnectorError` union — every branch instantiates via the redacting
 * static constructors, never exposing `rawProviderResponse` on the return
 * value (enforced at the type level by `ConnectorError` itself).
 */

import { ConnectorError } from "@eo/contracts";

export interface HttpStatusMappingInput {
  readonly status: number;
  readonly provider: string;
  /** Accepted for redaction derivation only — never stored on the returned `ConnectorError`. */
  readonly rawProviderResponse?: unknown;
}

/**
 * Maps an HTTP response status to exactly one canonical `ConnectorError`
 * member. Verb-agnostic — callers needing verb-specific nuance (e.g. a
 * verb-conditioned retry decision) consult `../transport/retry-ladder.js`
 * separately; this function's job is purely the status → canonical-kind
 * mapping.
 */
export function mapHttpStatusToConnectorError(input: HttpStatusMappingInput): ConnectorError {
  const { status, provider, rawProviderResponse } = input;
  const base = { provider, rawProviderResponse, message: `provider responded with HTTP ${status}` };

  if (status === 401) return ConnectorError.authentication({ ...base, retryable: false });
  if (status === 403) return ConnectorError.permission({ ...base, retryable: false });
  if (status === 404) return ConnectorError.notFound({ ...base, retryable: false });
  if (status === 409 || status === 412) return ConnectorError.conflict({ ...base, retryable: false });
  if (status === 429) return ConnectorError.rateLimited({ ...base, retryable: true });
  if (status === 400 || status === 422) return ConnectorError.validation({ ...base, retryable: false });
  if (status === 501) return ConnectorError.unsupported({ ...base, retryable: false });
  if (status >= 500) return ConnectorError.transient({ ...base, retryable: true });
  return ConnectorError.transient({ ...base, retryable: true });
}

/** Maps an arbitrary caught error (network failure, timeout, non-HTTP exception) to `transient` unless it is already a `ConnectorError`. */
export function mapUnknownErrorToConnectorError(err: unknown, provider: string): ConnectorError {
  if (err instanceof ConnectorError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return ConnectorError.transient({
    message: `unexpected transport failure: ${message}`,
    provider,
    retryable: true,
    rawProviderResponse: err,
  });
}
