/**
 * `EvidenceRecord` emission — roadmap/23-release-hardening.md work item 5's
 * own instruction: "Emit an EvidenceRecord per scenario tagged
 * release-gate:git-matrix." Mirrors `e2e/matrix/installation/src/
 * evidence.ts`'s identical pattern (and, ultimately,
 * `packages/git-engine/src/integration-journal.ts`'s
 * `buildEvidencePointerEntryInput` one-liner) — reproduced locally rather
 * than importing either sibling, since this project's own dependency edge
 * is `@crabgic/contracts` + `@crabgic/journal` + `@crabgic/git-engine` + `@crabgic/renderer`
 * only.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  EvidenceRecordSchema,
  type EvidenceRecord,
} from "@crabgic/contracts";
import type { JournalEntryInput, JournalStore } from "@crabgic/journal";

export const GIT_MATRIX_GATE_TAG = "release-gate:git-matrix";

/**
 * The roadmap/23 requirement each emitted tag evidences.
 *
 * WHY A LITERAL. `buildTraceabilityView` (`@crabgic/gates`) joins evidence to a
 * requirement on `EvidenceRecord.requirementId` and nothing else, so an
 * unstamped record — however genuine, however correctly tagged — contributes
 * nothing to 23's traceability criterion. The ids are UUIDv5 digests of the
 * exit-criterion text, derived by `e2e/attestation/src/releaseRequirements.
 * ts`; this project cannot import that module (each `e2e/*` harness is a
 * self-contained TypeScript project), so the value is declared here and
 * BOUND to its source by `e2e/attestation/src/requirementStamping.test.ts`,
 * which reads this file and fails if the two ever disagree. Duplicating the
 * derivation into every harness is the drift that test exists to prevent.
 *
 * `release-gate:git-matrix` evidences "No development-engine attribution in
 * any project-controlled shared artifact (08/10/17)" — the criterion this
 * harness's attribution-leak fixtures actually prove.
 */
export const REQUIREMENT_ID_BY_GATE_TAG = Object.freeze({
  "release-gate:git-matrix": "117e688c-e286-5c58-96a3-9788e868c90f",
} as const);

const TOOLCHAIN_FINGERPRINT = `node ${process.version}`;

/** Deterministic content digest — never a raw-output inline (`EvidenceRecord.artifactDigests`'s own contract). */
export function digestArtifact(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/**
 * `$CRABGIC_RELEASE_CANDIDATE_OBJECT_ID` when set and non-empty, else
 * `undefined` — the same env-var convention `e2e/live/src/evidence.ts`,
 * `e2e/release/src/evidence.ts` and `e2e/matrix/connector/src/support/
 * evidence.ts` already honor, and which this emitter was missing.
 *
 * WHY THIS MATTERS (2026-07-25 fix): every scenario here runs against its
 * own disposable throwaway repository and passes that repo's local object
 * ID. Those IDs can never equal the release candidate's, so `e2e/report`'s
 * generator — which links evidence ONLY at the exact
 * `releaseCandidateObjectId` — matched nothing this harness emitted. This
 * harness is the SOLE evidence source for the `no-engine-attribution`
 * checklist item, so that item sat at `EVIDENCE-PENDING` permanently while
 * the attribution-leak scenario that proves it ran green every time.
 * Emitting genuine evidence that is structurally unlinkable is
 * indistinguishable, at the gate, from emitting none at all.
 *
 * Deliberately NOT cached: a pure env read, so a test that sets/restores
 * the var within one process sees the truth.
 */
export function resolveReleaseCandidateObjectId(): string | undefined {
  const fromEnv = process.env["CRABGIC_RELEASE_CANDIDATE_OBJECT_ID"];
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : undefined;
}

export interface ScenarioEvidenceInput {
  readonly changeSetId: string;
  readonly command: string;
  readonly exitStatus: number;
  readonly objectId: string;
  readonly detail: string;
}

/**
 * Builds a schema-valid `EvidenceRecord` tagged `release-gate:git-matrix`
 * (round-tripped through `EvidenceRecordSchema.parse`).
 *
 * OBJECT ID: under a release run the record is stamped with the release
 * candidate, because that is the subject of the release claim ("at
 * candidate X, no attribution leaked and no checkout was mutated") — the
 * throwaway repo's own object ID is not what the gate asserts about. It is
 * not discarded, though: it is folded in as its own `artifactDigests`
 * entry, so the scenario stays auditable from the archived record. Outside
 * a release run (the default) behaviour is byte-identical to before.
 */
export function buildScenarioEvidence(input: ScenarioEvidenceInput): EvidenceRecord {
  const releaseCandidateObjectId = resolveReleaseCandidateObjectId();
  return EvidenceRecordSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId: input.changeSetId,
    command: input.command,
    exitStatus: input.exitStatus,
    toolchainFingerprint: TOOLCHAIN_FINGERPRINT,
    capturedAt: new Date().toISOString(),
    artifactDigests:
      releaseCandidateObjectId === undefined
        ? [digestArtifact(input.detail)]
        : [digestArtifact(input.detail), digestArtifact(`scenario-object-id:${input.objectId}`)],
    objectId: releaseCandidateObjectId ?? input.objectId,
    gateTag: GIT_MATRIX_GATE_TAG,
    requirementId: REQUIREMENT_ID_BY_GATE_TAG[GIT_MATRIX_GATE_TAG],
  });
}

/** Wraps `record` as an `evidence_pointer`-typed `JournalEntryInput` — the payload schema for this member IS `EvidenceRecordSchema` verbatim (`@crabgic/journal`'s own `journal-payloads.ts`). */
export function buildEvidencePointerEntryInput(
  record: EvidenceRecord,
  changeSetId: string,
): JournalEntryInput {
  return { type: "evidence_pointer", payload: record, changeSetId };
}

/** Builds and appends one `evidence_pointer` journal entry for a completed scenario run. */
export async function emitScenarioEvidence(
  journal: Pick<JournalStore, "appendEntry">,
  input: ScenarioEvidenceInput,
): Promise<EvidenceRecord> {
  const record = buildScenarioEvidence(input);
  await journal.appendEntry(buildEvidencePointerEntryInput(record, input.changeSetId));
  return record;
}
