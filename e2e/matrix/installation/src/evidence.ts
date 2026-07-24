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

const TOOLCHAIN_FINGERPRINT = `node ${process.version}`;

/** Deterministic content digest for a scenario's own detail string — never a raw-output inline, matching `EvidenceRecord.artifactDigests`'s own "content digests ... never inlining raw output" contract. */
export function digestArtifact(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export interface ScenarioEvidenceInput {
  readonly changeSetId: string;
  readonly command: string;
  readonly exitStatus: number;
  readonly objectId: string;
  readonly detail: string;
}

/** Builds a schema-valid `EvidenceRecord` tagged `release-gate:installation-matrix` (round-tripped through `EvidenceRecordSchema.parse`, not merely type-asserted — this package's own boundary-validation convention). */
export function buildScenarioEvidence(input: ScenarioEvidenceInput): EvidenceRecord {
  return EvidenceRecordSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId: input.changeSetId,
    command: input.command,
    exitStatus: input.exitStatus,
    toolchainFingerprint: TOOLCHAIN_FINGERPRINT,
    capturedAt: new Date().toISOString(),
    artifactDigests: [digestArtifact(input.detail)],
    objectId: input.objectId,
    gateTag: INSTALLATION_MATRIX_GATE_TAG,
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
