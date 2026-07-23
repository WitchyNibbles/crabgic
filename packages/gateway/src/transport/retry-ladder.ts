/**
 * Retry ladder — roadmap/16-gateway-core.md §In scope, "Retry ladder": "GET
 * free within budget; PUT/PATCH deterministic + precondition only; POST
 * never blind; 409/412 → fetch, rebase-or-block." Work item 2/4.
 *
 * A pure decision table: given the HTTP verb, whether the request carries
 * a precondition (an `If-Match`/expected-revision header equivalent), the
 * response status, and the current attempt count, decide the next action.
 * No I/O, no timers — `../http-client.ts` and the mutation pipeline are
 * the callers that act on the verdict.
 */

export type HttpVerb = "GET" | "PUT" | "PATCH" | "POST" | "DELETE";

export type RetryAction =
  | { readonly kind: "retry"; readonly reason: string }
  | { readonly kind: "fetch-rebase-or-block"; readonly reason: string }
  | { readonly kind: "give-up"; readonly reason: string };

export interface RetryDecisionInput {
  readonly verb: HttpVerb;
  readonly status: number;
  readonly hasPrecondition: boolean;
  readonly attempt: number; // 1-based: this is the Nth attempt that just completed
  readonly maxAttempts: number;
}

const RETRYABLE_TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Decides the next action after one HTTP attempt. Verb-specific rules
 * (16's own ladder, verbatim):
 *  - GET: free to retry within budget on any transient/rate-limited status.
 *  - PUT/PATCH: retried ONLY when the request carried a precondition
 *    (deterministic + conditioned on expected state) — a PUT/PATCH with no
 *    precondition is never blindly retried, since a retry after an
 *    ambiguous network failure could double-apply.
 *  - POST: NEVER blindly retried (could create a duplicate remote object)
 *    — the caller must reconcile via the marker-reconciliation interface
 *    instead (`../mutation-pipeline/reconciliation.js`).
 *  - 409/412 (conflict/precondition-failed) on any verb: always
 *    `fetch-rebase-or-block`, never a blind retry.
 */
export function decideRetryAction(input: RetryDecisionInput): RetryAction {
  const { verb, status, hasPrecondition, attempt, maxAttempts } = input;

  if (status === 409 || status === 412) {
    return { kind: "fetch-rebase-or-block", reason: `status ${status} requires rebase-or-block` };
  }

  if (status < 400) {
    return { kind: "give-up", reason: "success status, nothing to retry" };
  }

  if (attempt >= maxAttempts) {
    return { kind: "give-up", reason: "max attempts exhausted" };
  }

  if (!RETRYABLE_TRANSIENT_STATUSES.has(status)) {
    return { kind: "give-up", reason: `status ${status} is not retryable` };
  }

  switch (verb) {
    case "GET":
      return { kind: "retry", reason: "GET is free to retry within budget" };
    case "PUT":
    case "PATCH":
      if (hasPrecondition) {
        return { kind: "retry", reason: `${verb} carries a precondition; deterministic retry` };
      }
      return { kind: "give-up", reason: `${verb} without a precondition is never blindly retried` };
    case "POST":
      return { kind: "give-up", reason: "POST is never blindly retried" };
    case "DELETE":
      if (hasPrecondition) {
        return { kind: "retry", reason: "DELETE carries a precondition; deterministic retry" };
      }
      return { kind: "give-up", reason: "DELETE without a precondition is never blindly retried" };
    /* c8 ignore next 2 -- exhaustiveness guard */
    default: {
      const _exhaustive: never = verb;
      return { kind: "give-up", reason: `unknown verb ${String(_exhaustive)}` };
    }
  }
}
