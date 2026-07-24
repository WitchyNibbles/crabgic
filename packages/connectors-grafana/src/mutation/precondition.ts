/**
 * Optimistic-concurrency conflict resolution — roadmap/20-grafana-adapters.md
 * §In scope, "Mutation safety": "optimistic-concurrency writes (409/412 →
 * fetch-compare-rebase or an explicit block, never a blind overwrite)."
 *
 * `@eo/gateway`'s own mutation pipeline treats a 409/412 response as a
 * terminal `failed`/`conflict` outcome (it never itself retries a
 * precondition failure — see `../transport/retry-ladder.js`'s
 * `"fetch-rebase-or-block"` action, which the gateway's `GatewayHttpClient`
 * simply surfaces as-is rather than resolving). This module IS the
 * fetch-compare-rebase-or-block resolution roadmap/20 names as this
 * phase's own responsibility: given the remote content as it stood at the
 * plan's own baseline (captured at plan time — the same reading that
 * produced `RemoteMutationPlan.expectedRemoteRevision`) and the remote
 * content observed by a fresh read AFTER a 409/412, decide whether it is
 * safe to rebase (retry once against the fresh revision) or whether the
 * conflict must be surfaced as an explicit, typed block.
 *
 * The safety rule is deliberately conservative: rebase is offered ONLY
 * when the remote's CONTENT is byte-identical to our own baseline (i.e.
 * only the revision token itself went stale — e.g. a benign re-save with
 * no actual change, or a retried read racing a slow write of our own).
 * The moment remote content has genuinely diverged from our baseline, this
 * always blocks — retrying our own full-replace write in that case would
 * silently discard someone else's concurrent change, which is exactly the
 * "blind overwrite" this module exists to prevent.
 */

export type PreconditionResolution =
  | { readonly kind: "rebase"; readonly freshRevision: string }
  | { readonly kind: "block"; readonly reason: string };

export interface PreconditionConflictInput {
  /** The content hash of the remote resource AS IT STOOD when this plan's own baseline/precondition was captured. */
  readonly baselineContentHash: string;
  /** The remote resource's CURRENT state, freshly re-fetched after the 409/412. */
  readonly currentRemote: { readonly revision: string; readonly contentHash: string };
}

export function resolveOptimisticConcurrencyConflict(
  input: PreconditionConflictInput,
): PreconditionResolution {
  if (input.currentRemote.contentHash === input.baselineContentHash) {
    return { kind: "rebase", freshRevision: input.currentRemote.revision };
  }
  return {
    kind: "block",
    reason: `remote content has changed since this plan's baseline (now at revision ${input.currentRemote.revision}) — never rebasing over a genuine concurrent change`,
  };
}
