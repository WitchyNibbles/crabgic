import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";

/**
 * `EvidenceRecord` emission for the `@live` full-system conformance harness
 * (roadmap/23-release-hardening.md work item 7). Mirrors `e2e/matrix/
 * orchestration/src/evidence.ts`'s established pattern in this same phase
 * (plain typed-literal construction, no `@eo/gates` dependency — that
 * package's `emitEvidence` is typed against the closed `GateRiskTag` union,
 * which does not include this phase's own `release-gate:*` vocabulary;
 * `e2e/report/src/checklist.ts`'s own doc comment makes the same call:
 * "copied as plain string literals ... to keep this project's dependency
 * edge to exactly `@eo/contracts` + `@eo/journal`").
 *
 * The task brief for this work item names two tags directly:
 * `release-gate:live-conformance` (this harness's own umbrella — pinned-
 * range gate + hermeticity/sandbox self-test wiring) and
 * `release-gate:not-implemented-sweep` (the zero-`NOT_IMPLEMENTED` sweep's
 * own dedicated tag). Neither string is a `requiredGateTags` entry on
 * `e2e/report/src/checklist.ts`'s `RELEASE_GATE_CHECKLIST` — the ACTUAL
 * checklist item this work item's own exit criterion maps to is
 * `id: "gateway-cli-surface-complete"` ("Full 8-family gateway MCP tool
 * surface + full CLI surface return real behavior — zero NOT_IMPLEMENTED
 * remains (09/16, Gap 1/Gap 2's explicit phase-23 release-gate
 * obligation)"), whose own dedicated tag is
 * `release-gate:gateway-cli-surface-complete`. Following the same
 * documented-deviation call `e2e/matrix/orchestration/src/evidence.ts`
 * already made in this phase: every scenario below emits under ALL THREE
 * tags it applies to (its own dedicated task-brief tag PLUS, when
 * applicable, the real checklist-matching tag) rather than only the
 * literal task-brief string, so `e2e/report`'s generator can actually score
 * `gateway-cli-surface-complete` from this harness's own runs.
 */
export const LIVE_CONFORMANCE_GATE_TAG = "release-gate:live-conformance";
export const NOT_IMPLEMENTED_SWEEP_GATE_TAG = "release-gate:not-implemented-sweep";
export const GATEWAY_CLI_SURFACE_COMPLETE_GATE_TAG = "release-gate:gateway-cli-surface-complete";

/**
 * A fixed, documented stand-in for "the exact release-candidate object ID"
 * — this harness's own unit/integration tests run against this repo's
 * current working tree, not a frozen release cut, so a real invocation
 * (the `release-e2e` CI job) is expected to pass the actual
 * `git rev-parse HEAD` of the release candidate into `emitLiveConformance
 * Evidence`'s `objectId` override instead of this default. Mirrors
 * `e2e/matrix/orchestration/src/evidence.ts`'s identical `FAKE_RELEASE_
 * CANDIDATE_OBJECT_ID` convention.
 */
export const FAKE_RELEASE_CANDIDATE_OBJECT_ID = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

export interface EmitLiveConformanceEvidenceOptions {
  readonly journal: JournalStore;
  readonly changeSetId: string;
  /** Every gate tag this evidence record satisfies (OR-matched by `e2e/report`'s generator against each checklist item's `requiredGateTags` — but `EvidenceRecord.gateTag` is a single optional string, so a record satisfying N tags is emitted N times, once per tag, all other fields identical bar `id`/`capturedAt`). */
  readonly gateTags: readonly string[];
  readonly command: string;
  /** `0` for a genuine pass; non-zero communicates a genuine negative run (never fabricated to force a PASS). */
  readonly exitStatus: number;
  readonly artifactDigests?: readonly string[];
  readonly objectId?: string;
  readonly toolchainFingerprint?: string;
  /** Injectable clock — overridable for deterministic tests. */
  readonly capturedAt?: () => string;
}

/**
 * Builds and journals one `EvidenceRecord` (as an `evidence_pointer`
 * `JournalEntryType` entry) per tag in `options.gateTags` — see this
 * module's file-level doc comment for why a single scenario may need to
 * satisfy more than one checklist tag.
 */
export async function emitLiveConformanceEvidence(
  options: EmitLiveConformanceEvidenceOptions,
): Promise<readonly EvidenceRecord[]> {
  const capturedAt = (options.capturedAt ?? (() => new Date().toISOString()))();
  const records: EvidenceRecord[] = [];
  for (const gateTag of options.gateTags) {
    const record: EvidenceRecord = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: randomUUID(),
      changeSetId: options.changeSetId,
      command: options.command,
      exitStatus: options.exitStatus,
      toolchainFingerprint: options.toolchainFingerprint ?? "e2e/live/@live-conformance-harness@1",
      capturedAt,
      artifactDigests: options.artifactDigests !== undefined ? [...options.artifactDigests] : [],
      objectId: options.objectId ?? FAKE_RELEASE_CANDIDATE_OBJECT_ID,
      gateTag,
    };
    // Sequential by design: each append must land as its own journal entry,
    // in order; parallelizing gains nothing for a handful of tags and would
    // reorder `seq`.
    await options.journal.appendEntry({
      type: "evidence_pointer",
      changeSetId: options.changeSetId,
      payload: record,
    });
    records.push(record);
  }
  return records;
}
