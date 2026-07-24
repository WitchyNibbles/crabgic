import type { EvidenceRecord, Requirement, RemoteResource } from "@eo/contracts";
import type { RemoteEvidencePointer, RemoteResourceRelation } from "./remote-evidence-pointer.js";

/**
 * Traceability view — roadmap/21-connector-evidence-integration.md
 * §Interfaces produced: "requirement → work unit → exact object ID →
 * RemoteResource → confirmed revision, bidirectional." A pure, in-memory
 * projection over already-resolved inputs (no I/O of its own — callers
 * supply the `Requirement`/`EvidenceRecord`/`RemoteResource`/pointer lists,
 * typically read from 04's journal and 11's `IntentContract` assembly).
 *
 * `workUnitIds` comes straight off `Requirement.workUnitIds` (02's own
 * bidirectional-mapping field) — no separate WorkUnit-store dependency
 * needed here. `objectIds` are recovered from the `EvidenceRecord`s
 * journaled for this requirement (14's existing evidence-binding
 * mechanism, `evidence.ts`). `remoteResources` come from this phase's own
 * evidence-pointer linkage (`remote-evidence-pointer.ts`).
 *
 * MINOR-3 fix (adversarial-validation round): each `RemoteResource` binding
 * is now its OWN structured entry (`TraceabilityRemoteBinding`), not two
 * independently-deduped parallel arrays — a prior shape
 * (`remoteResourceIds: string[]` + `confirmedRevisions: string[]`) could
 * silently misalign once a requirement had more than one bound resource
 * (deduplication on each array independently is not guaranteed to preserve
 * a 1:1 index correspondence). `confirmedRevision`'s source of truth is now
 * explicitly `pointer.confirmedRevision` FIRST — the exact same value the
 * `remote_verification` gate (`remote-verification-gate.ts`) and the Jira
 * done-transition bridge (`@eo/connectors-jira`'s
 * `hasExactRevisionVerification`) already trust — falling back to the
 * `RemoteResource.revision` record only when the pointer itself carried no
 * `confirmedRevision`. If NEITHER source has a revision (including when the
 * pointer references a `RemoteResource` id absent from the supplied
 * `remoteResources` list entirely), `confirmedRevision` is `undefined` on
 * that binding — the binding itself is never dropped, so a caller can still
 * see "this RemoteResource IS bound, but no confirmed revision is known for
 * it yet" rather than that fact silently disappearing.
 */
export interface TraceabilityRemoteBinding {
  readonly remoteResourceId: string;
  readonly relation: RemoteResourceRelation;
  /** See file-level doc comment for the pointer-first, RemoteResource-fallback precedence; `undefined` if neither source has one. */
  readonly confirmedRevision?: string;
}

export interface TraceabilityEntry {
  readonly requirementId: string;
  readonly workUnitIds: readonly string[];
  readonly objectIds: readonly string[];
  readonly remoteResources: readonly TraceabilityRemoteBinding[];
}

export interface TraceabilityView {
  readonly entries: readonly TraceabilityEntry[];
  /** REVERSE index: RemoteResource id -> requirement id(s) pointing at it (fan-in: >1 requirement may point at the SAME RemoteResource). */
  readonly byRemoteResourceId: Readonly<Record<string, readonly string[]>>;
}

export interface BuildTraceabilityViewInput {
  readonly requirements: readonly Requirement[];
  readonly evidenceRecords: readonly EvidenceRecord[];
  readonly remoteResources: readonly RemoteResource[];
  readonly pointers: readonly RemoteEvidencePointer[];
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/** De-duplicates pointers pointing at the SAME `remoteResourceId` for one requirement (fan-out: one requirement -> multiple DISTINCT resources is preserved; a genuine duplicate pointer to the same resource collapses to one binding). */
function dedupeBindingsByRemoteResourceId(
  pointers: readonly RemoteEvidencePointer[],
): readonly RemoteEvidencePointer[] {
  const seen = new Map<string, RemoteEvidencePointer>();
  for (const pointer of pointers) {
    if (!seen.has(pointer.remoteResourceId)) {
      seen.set(pointer.remoteResourceId, pointer);
    }
  }
  return [...seen.values()];
}

export function buildTraceabilityView(input: BuildTraceabilityViewInput): TraceabilityView {
  const revisionByRemoteResourceId = new Map(input.remoteResources.map((r) => [r.id, r.revision]));
  const byRemoteResourceId: Record<string, string[]> = {};

  const entries: TraceabilityEntry[] = input.requirements.map((requirement) => {
    const evidenceForRequirement = input.evidenceRecords.filter(
      (e) => e.requirementId === requirement.id,
    );
    const pointersForRequirement = dedupeBindingsByRemoteResourceId(
      input.pointers.filter((p) => p.requirementId === requirement.id),
    );

    const objectIds = unique(evidenceForRequirement.map((e) => e.objectId));

    const remoteResources: TraceabilityRemoteBinding[] = pointersForRequirement.map((pointer) => {
      const confirmedRevision =
        pointer.confirmedRevision ?? revisionByRemoteResourceId.get(pointer.remoteResourceId);
      return {
        remoteResourceId: pointer.remoteResourceId,
        relation: pointer.relation,
        ...(confirmedRevision !== undefined ? { confirmedRevision } : {}),
      };
    });

    for (const binding of remoteResources) {
      const existing = byRemoteResourceId[binding.remoteResourceId] ?? [];
      byRemoteResourceId[binding.remoteResourceId] = [...existing, requirement.id];
    }

    return {
      requirementId: requirement.id,
      workUnitIds: unique(requirement.workUnitIds),
      objectIds,
      remoteResources,
    };
  });

  return { entries, byRemoteResourceId };
}
