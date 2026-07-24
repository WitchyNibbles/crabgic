/**
 * `EvidenceRecord` emission — roadmap/23-release-hardening.md work item 5's
 * own instruction: "Emit an EvidenceRecord per scenario tagged
 * release-gate:git-matrix." Mirrors `e2e/matrix/installation/src/
 * evidence.ts`'s identical pattern (and, ultimately,
 * `packages/git-engine/src/integration-journal.ts`'s
 * `buildEvidencePointerEntryInput` one-liner) — reproduced locally rather
 * than importing either sibling, since this project's own dependency edge
 * is `@eo/contracts` + `@eo/journal` + `@eo/git-engine` + `@eo/renderer`
 * only.
 */
import { createHash, randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, EvidenceRecordSchema, type EvidenceRecord } from "@eo/contracts";
import type { JournalEntryInput, JournalStore } from "@eo/journal";

export const GIT_MATRIX_GATE_TAG = "release-gate:git-matrix";

const TOOLCHAIN_FINGERPRINT = `node ${process.version}`;

/** Deterministic content digest — never a raw-output inline (`EvidenceRecord.artifactDigests`'s own contract). */
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

/** Builds a schema-valid `EvidenceRecord` tagged `release-gate:git-matrix` (round-tripped through `EvidenceRecordSchema.parse`). */
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
    gateTag: GIT_MATRIX_GATE_TAG,
  });
}

/** Wraps `record` as an `evidence_pointer`-typed `JournalEntryInput` — the payload schema for this member IS `EvidenceRecordSchema` verbatim (`@eo/journal`'s own `journal-payloads.ts`). */
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
