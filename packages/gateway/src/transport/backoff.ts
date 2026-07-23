/**
 * Retry-After + jittered bounded backoff — roadmap/16-gateway-core.md §In
 * scope, "Transport security": "≤4 in-flight per connection, Retry-After
 * + jittered bounded backoff." Work item 2. Pure computation; the caller
 * owns the actual `setTimeout`/sleep.
 */

export interface BackoffOptions {
  readonly baseMs: number;
  readonly maxMs: number;
  /** Injectable randomness source in `[0, 1)`, defaults to `Math.random`. */
  readonly random?: () => number;
}

const DEFAULT_BASE_MS = 200;
const DEFAULT_MAX_MS = 30_000;

/**
 * Computes the delay before the next attempt. When the server sent a
 * `Retry-After` header, that value (already parsed to milliseconds by the
 * caller) is honored verbatim, capped at `maxMs` — the server's own signal
 * always wins over the exponential curve. Otherwise: full-jitter
 * exponential backoff (`random() * min(maxMs, baseMs * 2^(attempt-1))`),
 * the AWS-recommended "full jitter" formula, which avoids the thundering-
 * herd effect a fixed or equal-jitter curve produces under concurrent
 * retries.
 */
export function computeBackoffDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  options: BackoffOptions = { baseMs: DEFAULT_BASE_MS, maxMs: DEFAULT_MAX_MS },
): number {
  const maxMs = options.maxMs;
  if (retryAfterMs !== undefined) {
    return Math.max(0, Math.min(retryAfterMs, maxMs));
  }

  const random = options.random ?? Math.random;
  const exponential = options.baseMs * 2 ** Math.max(0, attempt - 1);
  const cap = Math.min(maxMs, exponential);
  return Math.floor(random() * cap);
}

/** Parses a `Retry-After` header value (seconds, or an HTTP-date) to milliseconds. Returns `undefined` for an unparseable value. */
export function parseRetryAfterHeader(value: string | null, now: () => Date = () => new Date()): number | undefined {
  if (value === null || value.trim().length === 0) return undefined;

  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.round(asSeconds * 1000);
  }

  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) return undefined;
  const deltaMs = asDate.getTime() - now().getTime();
  return deltaMs > 0 ? deltaMs : 0;
}
