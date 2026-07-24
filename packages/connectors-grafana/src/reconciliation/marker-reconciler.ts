import { createHash } from "node:crypto";
import type { MarkerReconciler } from "@eo/gateway";
import type { GrafanaResourceKind } from "../resource-kinds.js";

/**
 * Deterministic marker derivation — roadmap/20-grafana-adapters.md
 * §Interfaces produced: "Reconciliation markers (deterministic UIDs +
 * annotation tags)... implementing 16's marker-reconciliation interface."
 * Derived from `RemoteMutationPlan.idempotencyKey` alone — the SAME
 * idempotency key always derives the SAME marker, so a retried create
 * (after a crash or a mid-POST timeout) always searches for exactly the
 * object its own earlier attempt would have created.
 */
export function deriveDeterministicUid(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16);
}

/** Annotations accept no caller-supplied identifier (roadmap/20 §In scope's own kind-by-kind rationale, mirrored in `../resources/definitions/annotation.js`) — their marker is carried as a tag instead of a uid. */
export function deriveAnnotationMarkerTag(idempotencyKey: string): string {
  return `eo-marker:${deriveDeterministicUid(idempotencyKey)}`;
}

export interface MarkerLookupDeps {
  readonly kind: GrafanaResourceKind;
  /** uid-addressable kinds (everything except `annotation`): GETs the candidate uid directly; `found: false` means genuinely not found, never a guess. */
  readonly getByUid?: (uid: string) => Promise<{ readonly found: boolean }>;
  /** `annotation` only: searches by tag, returning the found annotation's own `externalId` (its server-assigned numeric id, distinct from the tag itself) or `undefined`. */
  readonly findByTag?: (tag: string) => Promise<string | undefined>;
}

/**
 * Builds a `MarkerReconciler` (`@eo/gateway`'s marker-reconciliation
 * interface) for one Grafana resource kind. `findByMarker`'s `marker`
 * argument is exactly the kind-appropriate token
 * (`deriveDeterministicUid`/`deriveAnnotationMarkerTag`'s own output) — this
 * function never derives it itself, so a caller controls exactly which
 * plan's marker is being searched for.
 */
export function createGrafanaMarkerReconciler(deps: MarkerLookupDeps): MarkerReconciler {
  return {
    findByMarker: async (marker: string): Promise<string | undefined> => {
      if (deps.kind === "annotation") {
        if (deps.findByTag === undefined) return undefined;
        return deps.findByTag(marker);
      }
      if (deps.getByUid === undefined) return undefined;
      const result = await deps.getByUid(marker);
      return result.found ? marker : undefined;
    },
  };
}
