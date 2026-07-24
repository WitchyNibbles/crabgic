/**
 * Top-level intake orchestration — roadmap/11-intake-contract-approval.md
 * §In scope, "`ChangeSet` lifecycle" bullet: "exactly one `ChangeSet`
 * created per intake request; `draft -> awaiting_approval` on completion;
 * re-inspecting an unchanged repo state is idempotent (no duplicate
 * `ChangeSet`)." §Work item 3's failing-first framing: "re-inspecting an
 * unchanged repo never creates a second `ChangeSet`."
 *
 * IDEMPOTENCY MECHANISM (documented decision): reuses 04's own
 * `IdempotencyRegistry` (`@eo/journal`) exactly as designed for this kind
 * of generic "same operation, same content -> same recorded result" check
 * — keyed by `(operationId, contentHash)` where `operationId =
 * "intake:" + request.requestKey` (a caller-supplied stable identity for
 * "this repo/intake session", e.g. derived from the project root path) and
 * `contentHash` is the canonical hash of every intake-request field. Same
 * `requestKey` + unchanged content -> "replayed" (the exact same,
 * previously-built `ChangeSet` id is returned, never a second one, backed
 * by a real `remote_operation_record` journal entry — journal-verified).
 * Same `requestKey` + CHANGED content -> "conflict": this module refuses
 * to silently mint a second `ChangeSet` for the same request identity;
 * roadmap/11 §In scope: "New requests -> separate `ChangeSet` unless
 * explicit amendment" — a genuinely new intake must supply a fresh
 * `requestKey` (the caller's responsibility, e.g. derived from a fresh
 * timestamp or session id); an already-approved envelope's own material
 * change instead goes through `./amendment.ts`, not a second `runIntake`
 * call for the same `requestKey`.
 */
import {
  CURRENT_SCHEMA_VERSION,
  ChangeSetSchema,
  type AuthorizationEnvelope,
  type CapabilityManifest,
  type ChangeSet,
  type IntentContract,
  type IntentContractSections,
  type PerformanceBudgetSource,
  type ProvisionalPerformanceBudgetEntry,
  type ProvisionalPerformanceContract,
  type Requirement,
  type WorkUnit,
} from "@eo/contracts";
import { IdempotencyRegistry, type JournalStore } from "@eo/journal";
import type { Registry } from "../registries/registry.js";
import { canonicalHash } from "./canonical-hash.js";
import { buildIntentContract, type RequirementDraft } from "./contract-builder.js";
import { buildWorkUnitGraph, type WorkUnitDraft } from "./dag-builder.js";
import {
  buildAuthorizationEnvelope,
  type AuthorizationEnvelopeContent,
} from "./envelope-builder.js";
import {
  buildCapabilityManifest,
  type BuildCapabilityManifestOptions,
} from "./capability-manifest-builder.js";
import { buildProvisionalPerformanceContract } from "./performance-contract-builder.js";
import { deriveStableId } from "./stable-id.js";
import { transitionChangeSet } from "./change-set-transition.js";

export interface IntakeRequest {
  /** Stable identity for "this repo/intake session" — same key + unchanged content replays; same key + changed content conflicts (see file-level doc comment). */
  readonly requestKey: string;
  /** This intake's ChangeSet id. Caller-supplied so the caller controls id provenance (deterministic fixture ids in tests, `crypto.randomUUID()` in production). */
  readonly id: string;
  readonly createdAt: string;
  readonly sections: IntentContractSections;
  readonly requirements: readonly RequirementDraft[];
  readonly workUnits: readonly WorkUnitDraft[];
  readonly envelopeContent: AuthorizationEnvelopeContent;
  readonly rollbackStrategy: string;
  readonly performanceBudgetSource: PerformanceBudgetSource;
  readonly performanceBudgets: readonly ProvisionalPerformanceBudgetEntry[];
  readonly capabilityManifest?: Omit<
    BuildCapabilityManifestOptions,
    "id" | "changeSetId" | "createdAt"
  >;
}

export interface IntakeArtifacts {
  readonly changeSet: ChangeSet;
  readonly intentContract: IntentContract;
  readonly requirements: readonly Requirement[];
  readonly workUnits: readonly WorkUnit[];
  readonly envelope: AuthorizationEnvelope;
  readonly capabilityManifest: CapabilityManifest;
  readonly provisionalPerformanceContract: ProvisionalPerformanceContract;
}

export type IntakeOutcome =
  | { readonly status: "created"; readonly artifacts: IntakeArtifacts }
  | { readonly status: "replayed"; readonly artifacts: IntakeArtifacts }
  | { readonly status: "conflict"; readonly existingContentHash: string };

export interface IntakeDeps {
  readonly journal: JournalStore;
  readonly changeSets: Registry<ChangeSet>;
  readonly workUnits: Registry<WorkUnit>;
  /**
   * Added during this phase's adversarial-validation repair pass (CRITICAL
   * C1): the built `AuthorizationEnvelope` must be durably resolvable by
   * id so `contract.approve` can derive the EXPECTED digest server-side
   * from the ChangeSet it is actually asked to flip, rather than trusting
   * a caller-supplied digest (see `../registries/authorization-envelopes-
   * registry.ts`'s own doc comment).
   */
  readonly envelopes: Registry<AuthorizationEnvelope>;
}

function requestContentHash(request: IntakeRequest): string {
  return canonicalHash({
    sections: request.sections,
    requirements: request.requirements.map((r) => ({ ...r })),
    workUnits: request.workUnits.map((w) => ({ ...w })),
    envelopeContent: { ...request.envelopeContent },
    rollbackStrategy: request.rollbackStrategy,
    performanceBudgetSource: request.performanceBudgetSource,
    performanceBudgets: request.performanceBudgets.map((b) => ({ ...b })),
  });
}

/**
 * Pure assembly: builds every artifact for `request`, at `draft` state — no
 * journal/registry side effects. Exported (beyond `runIntake`'s own
 * internal use) so a conformance suite can assert byte-stability across
 * two independent builds without any journal/registry machinery
 * (roadmap/11 §Exit criteria: "Golden IntentContract/DAG/
 * AuthorizationEnvelope/CapabilityManifest fixtures byte-stable across two
 * builds").
 */
/** The exact `Requirement`/`WorkUnit`-scoping `intentContractId` this pipeline derives for `changeSetId` — exported (LOW L6 repair) so a caller needing to compute a `Requirement`'s id BEFORE calling `buildIntakeArtifacts` (e.g. `./goldens/fixture-request.ts`, wiring a real bidirectional requirement<->work-unit mapping via `./contract-builder.js`'s `computeRequirementId`) uses the identical derivation, never a duplicated/drifting formula. */
export function computeIntentContractId(changeSetId: string): string {
  return deriveStableId(`${changeSetId}:intent-contract`);
}

export function buildIntakeArtifacts(request: IntakeRequest): IntakeArtifacts {
  const intentContractId = computeIntentContractId(request.id);
  const envelopeId = deriveStableId(`${request.id}:envelope`);
  const manifestId = deriveStableId(`${request.id}:capability-manifest`);
  const perfContractId = deriveStableId(`${request.id}:provisional-performance-contract`);

  const { intentContract, requirements } = buildIntentContract({
    id: intentContractId,
    changeSetId: request.id,
    createdAt: request.createdAt,
    sections: request.sections,
    requirements: request.requirements,
  });

  const { workUnits, integrationOrder } = buildWorkUnitGraph({
    changeSetId: request.id,
    requirementIds: intentContract.requirementIds,
    workUnits: request.workUnits,
  });

  const envelope = buildAuthorizationEnvelope({
    id: envelopeId,
    changeSetId: request.id,
    createdAt: request.createdAt,
    content: request.envelopeContent,
  });

  const capabilityManifest = buildCapabilityManifest({
    id: manifestId,
    changeSetId: request.id,
    createdAt: request.createdAt,
    ...(request.capabilityManifest ?? {}),
  });

  const provisionalPerformanceContract = buildProvisionalPerformanceContract({
    id: perfContractId,
    changeSetId: request.id,
    createdAt: request.createdAt,
    budgetSource: request.performanceBudgetSource,
    budgets: request.performanceBudgets,
  });

  const changeSet: ChangeSet = ChangeSetSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: request.id,
    state: "draft",
    intentContractId,
    authorizationEnvelopeId: envelopeId,
    capabilityManifestId: manifestId,
    provisionalPerformanceContractId: perfContractId,
    integrationOrder: [...integrationOrder],
    rollbackStrategy: request.rollbackStrategy,
    createdAt: request.createdAt,
  } satisfies ChangeSet);

  return {
    changeSet,
    intentContract,
    requirements,
    workUnits,
    envelope,
    capabilityManifest,
    provisionalPerformanceContract,
  };
}

/**
 * Runs one intake request end-to-end: builds every artifact, creates
 * EXACTLY ONE `ChangeSet` (journal-verified idempotent — see file-level
 * doc comment), and drives its `draft -> awaiting_approval` transition on
 * first creation. Never re-runs the `draft -> awaiting_approval` transition
 * on a replay within the SAME process (the registry already reflects it);
 * on a replay against a registry that doesn't yet know this ChangeSet (a
 * fresh process rehydrating from a journal a prior process wrote), rebuilds
 * the registry entries and performs that one transition exactly once.
 */
export async function runIntake(deps: IntakeDeps, request: IntakeRequest): Promise<IntakeOutcome> {
  const idempotency = new IdempotencyRegistry(deps.journal);
  const outcome = await idempotency.checkOrRecord<IntakeArtifacts>(
    `intake:${request.requestKey}`,
    requestContentHash(request),
    () => buildIntakeArtifacts(request),
  );

  if (outcome.status === "conflict") {
    return { status: "conflict", existingContentHash: outcome.existingContentHash! };
  }

  const artifacts = outcome.result!;
  const alreadyKnown = deps.changeSets.get(artifacts.changeSet.id) !== undefined;

  if (!alreadyKnown) {
    deps.changeSets.put(artifacts.changeSet);
    deps.envelopes.put(artifacts.envelope);
    for (const workUnit of artifacts.workUnits) deps.workUnits.put(workUnit);
    await transitionChangeSet({
      journal: deps.journal,
      changeSets: deps.changeSets,
      changeSetId: artifacts.changeSet.id,
      to: "awaiting_approval",
    });
  }

  const finalChangeSet = deps.changeSets.get(artifacts.changeSet.id)!;
  return {
    status: outcome.status === "recorded" ? "created" : "replayed",
    artifacts: { ...artifacts, changeSet: finalChangeSet },
  };
}
