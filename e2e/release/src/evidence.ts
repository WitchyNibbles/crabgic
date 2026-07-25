import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@eo/contracts";
import type { JournalStore } from "@eo/journal";

/**
 * `EvidenceRecord` emission for the reproducible-build + publication-
 * dry-run tooling (roadmap/23-release-hardening.md work item 10). Mirrors
 * `e2e/matrix/orchestration/src/evidence.ts` / `e2e/live/src/evidence.ts`'s
 * established pattern in this same phase (plain typed-literal
 * construction, `@eo/contracts` + `@eo/journal` only — no `@eo/gates`
 * dependency, whose `emitEvidence` is typed against the closed
 * `GateRiskTag` union rather than this phase's own `release-gate:*`
 * vocabulary).
 *
 * Unlike `e2e/matrix/orchestration`'s own documented tag mismatch, this
 * work item's task brief and `e2e/report/src/checklist.ts`'s own
 * `"reproducible-build"` checklist item agree exactly:
 * `release-gate:reproducible-build` is both the task's own instruction AND
 * that item's `requiredGateTags[0]` — no second tag is needed for the
 * checklist to score it. `release-gate:engine-pin-recorded` is emitted
 * additionally where applicable (the SDK-pin cross-check), since that is
 * this work item's OWN separate checklist item too.
 */
export const REPRODUCIBLE_BUILD_GATE_TAG = "release-gate:reproducible-build";
export const ENGINE_PIN_RECORDED_GATE_TAG = "release-gate:engine-pin-recorded";

/**
 * A fixed, documented stand-in for "the exact release-candidate object ID"
 * — this harness's own tests run against this repo's current working
 * tree/HEAD, not a frozen release cut. A real `release-e2e` CI invocation
 * supplies the actual `git rev-parse HEAD` of the release candidate
 * instead — either via `emitReproducibleBuildEvidence`'s explicit
 * `objectId` option or, for callers that never pass one, via
 * `$EO_RELEASE_CANDIDATE_OBJECT_ID` (see
 * `resolveReleaseCandidateObjectId` below).
 */
export const FAKE_RELEASE_CANDIDATE_OBJECT_ID = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

/**
 * The object ID this harness stamps on emitted evidence when no explicit
 * `objectId` override is supplied: `$EO_RELEASE_CANDIDATE_OBJECT_ID` when
 * set and non-empty (the same env-var convention `e2e/report/src/cli.ts`
 * already honors), else `FAKE_RELEASE_CANDIDATE_OBJECT_ID` — so an
 * ordinary `npm run test:e2e` run is byte-identical to before this seam
 * existed, while a real release-gate run accumulates evidence the report
 * generator can actually link to its `releaseCandidateObjectId`.
 *
 * Deliberately NOT cached: a pure env read, so tests that set/restore the
 * var within one process see the truth.
 */
export function resolveReleaseCandidateObjectId(): string {
  const fromEnv = process.env["EO_RELEASE_CANDIDATE_OBJECT_ID"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return FAKE_RELEASE_CANDIDATE_OBJECT_ID;
}

export interface EmitReproducibleBuildEvidenceOptions {
  readonly journal: JournalStore;
  readonly changeSetId: string;
  readonly gateTags: readonly string[];
  readonly command: string;
  /** `0` for a genuine pass; non-zero communicates a genuine negative run (never fabricated to force a PASS). */
  readonly exitStatus: number;
  readonly artifactDigests?: readonly string[];
  readonly objectId?: string;
  readonly toolchainFingerprint?: string;
  readonly capturedAt?: () => string;
}

/** Builds and journals one `EvidenceRecord` (as an `evidence_pointer` `JournalEntryType` entry) per tag in `options.gateTags`. */
export async function emitReproducibleBuildEvidence(
  options: EmitReproducibleBuildEvidenceOptions,
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
      toolchainFingerprint: options.toolchainFingerprint ?? "e2e/release/@reproducible-build@1",
      capturedAt,
      artifactDigests: options.artifactDigests !== undefined ? [...options.artifactDigests] : [],
      objectId: options.objectId ?? resolveReleaseCandidateObjectId(),
      gateTag,
    };
    // Sequential by design: each append must land as its own journal entry,
    // in order.
    await options.journal.appendEntry({
      type: "evidence_pointer",
      changeSetId: options.changeSetId,
      payload: record,
    });
    records.push(record);
  }
  return records;
}
