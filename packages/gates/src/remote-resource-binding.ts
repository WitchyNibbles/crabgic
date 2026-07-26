import type { EvidenceRecord, RemoteResource } from "@eo/contracts";
import { stampGrafanaRemoteResource, type GrafanaResourceKind } from "@eo/connectors-grafana";
import { stampJiraRemoteResource } from "@eo/connectors-jira";
import type { MutationApplyResult } from "@eo/gateway";
import type { JournalStore } from "@eo/journal";
import {
  recordEvidencePointer,
  type RemoteEvidencePointer,
  type RemoteResourceRelation,
} from "./remote-evidence-pointer.js";

/**
 * THE PRODUCTION WRITER — roadmap/21-connector-evidence-integration.md work
 * item 1 ("write `evidence_pointer` `JournalEntryType` entries linking
 * `Requirement.id`<->`RemoteResource.id` as 18/20 resolve tracking issues/
 * dashboards") and work item 2 ("bind the read-back-verified remote
 * revision that 16's pipeline confirms").
 *
 * WHY THIS FILE EXISTS. Before it, `stampJiraRemoteResource` (18),
 * `stampGrafanaRemoteResource` (20) and `recordEvidencePointer` (21) had
 * ZERO production callers anywhere in this repository — definitions, barrel
 * re-exports and `.test.ts` files only. Work item 1's writer half was never
 * built, so a live tenant produced no `RemoteResource`s and no evidence
 * pointers, and `buildTraceabilityView` — which derives its bindings
 * EXCLUSIVELY from pointers (`./traceability-view.ts`; `remoteResources` is
 * only a revision lookup/fallback) — had nothing to bind.
 *
 * WHY IT LIVES IN `packages/gates`. roadmap/21 §Primary packages names
 * `packages/gates` first, and the dependency graph forces it: `@eo/gates`
 * already depends on `@eo/connectors-jira` and `@eo/connectors-grafana`, so
 * the reverse edge (a writer inside a connector package importing
 * `recordEvidencePointer`) would make `scripts/check-package-graph-acyclic.mjs`
 * fail. This module is the one place both connectors' stamps and 21's
 * pointer writer can legally meet.
 *
 * THE REVISION IS NEVER CALLER-INVENTED. It is taken from
 * `MutationApplyResult.appliedRevision` — `@eo/gateway`'s own "confirmed
 * remote revision this record's read-back step observed". A caller that has
 * not actually run a mutation through `executeMutationPlan` has no such
 * value to pass, which is the point: this writer cannot be used to stamp an
 * unverified revision.
 */

/** Thrown when a Grafana resource kind has no honest `RemoteResourceRelation` — refuses rather than silently mislabelling the binding. */
export class UnbindableRemoteResourceKindError extends Error {
  readonly kind: string;

  constructor(kind: string) {
    super(
      `gates: Grafana resource kind "${kind}" has no RemoteResourceRelation member that honestly ` +
        `describes it (relations are: tracking-issue | dashboard | alert) — refusing to bind it ` +
        `under a misleading relation`,
    );
    this.name = "UnbindableRemoteResourceKindError";
    this.kind = kind;
  }
}

/** Thrown when the mutation pipeline yielded no usable confirmed revision — a pointer without one records "we pointed at it", not "we verified it". */
export class MissingConfirmedRevisionError extends Error {
  constructor(requirementId: string) {
    super(
      `gates: refusing to bind a remote resource for requirement "${requirementId}" with an empty ` +
        `MutationApplyResult.appliedRevision — a binding with no confirmed revision is exactly the ` +
        `false green the remote_verification gate exists to prevent`,
    );
    this.name = "MissingConfirmedRevisionError";
  }
}

/**
 * The only two Grafana kinds a `RemoteResourceRelation` honestly covers.
 * The relation vocabulary is 02/21's closed 3-member list
 * (`tracking-issue | dashboard | alert`); `folder`, `annotation`,
 * `contact-point`, `mute-timing` and `notification-template` map to none of
 * them, and widening `REMOTE_RESOURCE_RELATIONS` is a cross-phase contract
 * change this module deliberately does not make. Absent key = refuse.
 */
const GRAFANA_RELATION_BY_KIND: Readonly<
  Partial<Record<GrafanaResourceKind, RemoteResourceRelation>>
> = {
  dashboard: "dashboard",
  "alert-rule": "alert",
};

export type RemoteBindingTarget =
  | { readonly provider: "jira"; readonly issueKey: string }
  | {
      readonly provider: "grafana";
      readonly kind: GrafanaResourceKind;
      readonly externalId: string;
    };

export interface BindRemoteResourceEvidenceInput {
  readonly requirementId: string;
  readonly changeSetId: string;
  /** The exact object id under test at binding time — the release-candidate/WorkUnit candidate object ID. */
  readonly objectId: string;
  readonly externalConnectionId: string;
  readonly target: RemoteBindingTarget;
  /** The pipeline's own confirmed read-back result (`@eo/gateway`). */
  readonly applied: MutationApplyResult;
  readonly canonicalUrl?: string;
  /** ISO instant the revision was observed; defaults to `now()`. */
  readonly observedAt?: string;
  readonly now?: () => Date;
}

export interface RemoteResourceBinding {
  readonly resource: RemoteResource;
  readonly relation: RemoteResourceRelation;
  /** The pointer as the journal will decode it back — verified equal to `findRemoteResourcePointersForRequirement`'s output by this module's own suite. */
  readonly pointer: RemoteEvidencePointer;
  readonly evidenceRecord: EvidenceRecord;
}

function resolveRelation(target: RemoteBindingTarget): RemoteResourceRelation {
  if (target.provider === "jira") return "tracking-issue";
  const relation = GRAFANA_RELATION_BY_KIND[target.kind];
  if (relation === undefined) throw new UnbindableRemoteResourceKindError(target.kind);
  return relation;
}

function stamp(
  target: RemoteBindingTarget,
  input: BindRemoteResourceEvidenceInput,
  observedAt: string,
): RemoteResource {
  const canonicalUrl = input.canonicalUrl;
  if (target.provider === "jira") {
    return stampJiraRemoteResource({
      externalConnectionId: input.externalConnectionId,
      issueKey: target.issueKey,
      revision: input.applied.appliedRevision,
      observedAt,
      ...(canonicalUrl !== undefined ? { canonicalUrl } : {}),
    });
  }
  return stampGrafanaRemoteResource({
    externalConnectionId: input.externalConnectionId,
    kind: target.kind,
    externalId: target.externalId,
    revision: input.applied.appliedRevision,
    observedAt,
    ...(canonicalUrl !== undefined ? { canonicalUrl } : {}),
  });
}

/**
 * Stamps a `RemoteResource` from a confirmed mutation and journals the
 * `evidence_pointer` that binds it to `requirementId`.
 *
 * Both refusal paths throw BEFORE anything is written, so a refused binding
 * leaves the journal untouched rather than half-written.
 */
export async function bindRemoteResourceEvidence(
  journal: JournalStore,
  input: BindRemoteResourceEvidenceInput,
): Promise<RemoteResourceBinding> {
  const relation = resolveRelation(input.target);
  const confirmedRevision = input.applied.appliedRevision;
  if (confirmedRevision.trim().length === 0) {
    throw new MissingConfirmedRevisionError(input.requirementId);
  }

  const now = input.now ?? ((): Date => new Date());
  const observedAt = input.observedAt ?? now().toISOString();
  const resource = stamp(input.target, input, observedAt);

  const evidenceRecord = await recordEvidencePointer(journal, {
    requirementId: input.requirementId,
    remoteResourceId: resource.id,
    relation,
    changeSetId: input.changeSetId,
    objectId: input.objectId,
    confirmedRevision,
    now,
  });

  const pointer: RemoteEvidencePointer = {
    requirementId: input.requirementId,
    remoteResourceId: resource.id,
    relation,
    objectId: input.objectId,
    confirmedRevision,
    evidenceRecordId: evidenceRecord.id,
  };

  return { resource, relation, pointer, evidenceRecord };
}
