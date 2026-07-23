/**
 * Marker-reconciliation interface — roadmap/16-gateway-core.md §In scope,
 * "Ambiguity": "marker-reconciliation interface declared here, adapters
 * implement it (Jira entity properties, 18; deterministic UIDs +
 * annotation tags, 20); ambiguous POST timeout → search marker before
 * retry; unresolvable → canonical `ambiguous_write`, outcome treated as
 * unknown, **block** — never a guessed duplicate." Work item 4.
 *
 * This module declares the interface and the reconcile-or-block decision
 * only. It is deliberately provider-agnostic: 18/20 implement
 * `MarkerReconciler` against their own remote's marker mechanism
 * (Jira entity properties / deterministic UIDs + annotation tags) and call
 * `reconcileAmbiguousPost` from inside their own `apply()` handler after a
 * mid-POST timeout, before ever considering a blind retry.
 */

export interface MarkerReconciler {
  /**
   * Searches the remote system for an object already carrying `marker`
   * (a deterministic, plan-derived token embedded at create time — e.g. a
   * Jira entity property or a Grafana annotation tag). Returns the
   * found object's canonical identifier, or `undefined` if genuinely not
   * found (never a guess).
   */
  findByMarker(marker: string): Promise<string | undefined>;
}

export type AmbiguousPostOutcome =
  | { readonly kind: "reconciled"; readonly canonicalTarget: string }
  | { readonly kind: "blocked"; readonly reason: string };

/** Thrown by an `apply()` handler once reconciliation could not resolve an ambiguous POST — the mutation pipeline maps this to a `blocked` outcome with `errorKind: "ambiguous_write"`, never a retry. */
export class AmbiguousWriteBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`ambiguous write blocked: ${reason}`);
    this.name = "AmbiguousWriteBlockedError";
    this.reason = reason;
    Object.freeze(this);
  }
}

/**
 * Searches for `marker` via `reconciler.findByMarker`. Returns
 * `{ kind: "reconciled", canonicalTarget }` when found; otherwise
 * `{ kind: "blocked", reason }` — the outcome is treated as unknown, never
 * assumed to be a duplicate-safe retry target.
 */
export async function reconcileAmbiguousPost(
  reconciler: MarkerReconciler,
  marker: string,
): Promise<AmbiguousPostOutcome> {
  const found = await reconciler.findByMarker(marker);
  if (found !== undefined) {
    return { kind: "reconciled", canonicalTarget: found };
  }
  return {
    kind: "blocked",
    reason: `marker "${marker}" not found after ambiguous POST timeout; outcome treated as unknown`,
  };
}

/** Throws `AmbiguousWriteBlockedError` when `outcome` is `blocked` — narrows to the `reconciled` branch otherwise. */
export function assertReconciled(
  outcome: AmbiguousPostOutcome,
): asserts outcome is Extract<AmbiguousPostOutcome, { kind: "reconciled" }> {
  if (outcome.kind === "blocked") {
    throw new AmbiguousWriteBlockedError(outcome.reason);
  }
}
