/**
 * `EvidenceRecord` emission — roadmap/23-release-hardening.md work item 3's
 * own instruction: "Emit an EvidenceRecord (02 schema) per scenario tagged
 * with a `release-gate:installation-matrix` gate tag (so e2e/report's
 * generator can score it — see e2e/report/src/checklist.ts for the tag
 * convention)." Mirrors `packages/git-engine/src/integration-journal.ts`'s
 * `buildEvidencePointerEntryInput` pattern (a one-line `{ type:
 * "evidence_pointer", payload, changeSetId }` wrapper) rather than
 * importing that helper from `@eo/git-engine` — this project's dependency
 * edge has no other reason to touch `@eo/git-engine`, so the one-liner is
 * reproduced locally instead of adding an unrelated package dependency for
 * a single trivial call.
 */
import { createHash, randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, EvidenceRecordSchema, type EvidenceRecord } from "@eo/contracts";
import type { JournalEntryInput, JournalStore } from "@eo/journal";

export const INSTALLATION_MATRIX_GATE_TAG = "release-gate:installation-matrix";

/**
 * The roadmap/23 requirement each emitted tag evidences.
 *
 * WHY A LITERAL. `buildTraceabilityView` (`@eo/gates`) joins evidence to a
 * requirement on `EvidenceRecord.requirementId` and nothing else, so an
 * unstamped record — however genuine, however correctly tagged — contributes
 * nothing to 23's traceability criterion. The ids are UUIDv5 digests of the
 * exit-criterion text, derived by `e2e/attestation/src/releaseRequirements.
 * ts`; this project cannot import that module (each `e2e/*` harness is a
 * self-contained TypeScript project), so the value is declared here and
 * BOUND to its source by `e2e/attestation/src/requirementStamping.test.ts`,
 * which reads this file and fails if the two ever disagree.
 *
 * `release-gate:installation-matrix` evidences "No user checkout, remote Git
 * repository, or unauthorized provider resource modified anywhere in the
 * matrix" — the criterion this harness's own assertion log proves, and the
 * one release requirement whose evidence this harness alone can supply
 * unambiguously (`git-matrix` and `connector-matrix` each carry a nearer
 * criterion of their own).
 */
export const REQUIREMENT_ID_BY_GATE_TAG = Object.freeze({
  "release-gate:installation-matrix": "a6ec5e44-7901-5f4c-8d48-e5901d8384b4",
} as const);

const TOOLCHAIN_FINGERPRINT = `node ${process.version}`;

/** Deterministic content digest for a scenario's own detail string — never a raw-output inline, matching `EvidenceRecord.artifactDigests`'s own "content digests ... never inlining raw output" contract. */
export function digestArtifact(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

/**
 * `$EO_RELEASE_CANDIDATE_OBJECT_ID` when set and non-empty, else
 * `undefined` — the same env-var convention `e2e/live/src/evidence.ts`,
 * `e2e/release/src/evidence.ts` and `e2e/matrix/connector/src/support/
 * evidence.ts` already honor, and which this emitter was missing.
 *
 * WHY THIS MATTERS (2026-07-25 fix): every scenario here runs against its
 * own disposable throwaway repository and passes that repo's local object
 * ID. Those IDs can never equal the release candidate's, so `e2e/report`'s
 * generator — which links evidence ONLY at the exact
 * `releaseCandidateObjectId` — matched nothing this harness emitted, and
 * the checklist items it feeds stayed unscored no matter how green the
 * harness ran. Emitting genuine evidence that is structurally unlinkable
 * is indistinguishable, at the gate, from emitting none at all.
 *
 * Deliberately NOT cached: a pure env read, so a test that sets/restores
 * the var within one process sees the truth.
 */
export function resolveReleaseCandidateObjectId(): string | undefined {
  const fromEnv = process.env["EO_RELEASE_CANDIDATE_OBJECT_ID"];
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
 * Builds a schema-valid `EvidenceRecord` tagged
 * `release-gate:installation-matrix` (round-tripped through
 * `EvidenceRecordSchema.parse`, not merely type-asserted — this package's
 * own boundary-validation convention).
 *
 * OBJECT ID: under a release run the record is stamped with the release
 * candidate, because that is the subject of the release claim ("at
 * candidate X, the installation matrix held") — the throwaway repo's own
 * object ID is not what the gate asserts about. It is not discarded,
 * though: it is folded in as its own `artifactDigests` entry, so the
 * scenario stays auditable from the archived record. Outside a release run
 * (the default) behaviour is byte-identical to before: the scenario's own
 * object ID is stamped, and exactly one digest is emitted.
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
    gateTag: INSTALLATION_MATRIX_GATE_TAG,
    requirementId: REQUIREMENT_ID_BY_GATE_TAG[INSTALLATION_MATRIX_GATE_TAG],
  });
}

/** Wraps `record` as an `evidence_pointer`-typed `JournalEntryInput` — the payload schema for this member IS `EvidenceRecordSchema` verbatim (`@eo/journal`'s own `journal-payloads.ts`), mirrored here rather than imported since this project deliberately limits its dependency surface. */
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
