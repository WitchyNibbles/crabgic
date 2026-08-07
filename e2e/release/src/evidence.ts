import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";

/**
 * `EvidenceRecord` emission for the reproducible-build + publication-
 * dry-run tooling (roadmap/23-release-hardening.md work item 10). Mirrors
 * `e2e/matrix/orchestration/src/evidence.ts` / `e2e/live/src/evidence.ts`'s
 * established pattern in this same phase (plain typed-literal
 * construction, `@crabgic/contracts` + `@crabgic/journal` only — no `@crabgic/gates`
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
 * The roadmap/23 requirement each emitted tag evidences.
 *
 * WHY A LITERAL. `buildTraceabilityView` (`@crabgic/gates`) joins evidence to a
 * requirement on `EvidenceRecord.requirementId` and nothing else, so an
 * unstamped record — however genuine, however correctly tagged —
 * contributes nothing to 23's traceability criterion. The ids are UUIDv5
 * digests of the exit-criterion text, derived by
 * `e2e/attestation/src/releaseRequirements.ts`; this project cannot import
 * that module (each `e2e/*` harness is a self-contained TypeScript project),
 * so the values are declared here and BOUND to their source by
 * `e2e/attestation/src/requirementStamping.test.ts`, which reads this file
 * and fails if the two ever disagree.
 *
 * A map rather than one constant because this harness's two tags are two
 * SEPARATE roadmap/23 exit criteria (`:136` reproducible build, `:137`
 * engine-pin recorded), as this module's own header already notes.
 */
export const REQUIREMENT_ID_BY_GATE_TAG = Object.freeze({
  "release-gate:reproducible-build": "80b7e1bb-d84b-5d6b-8340-8e9b4b01f4e1",
  "release-gate:engine-pin-recorded": "bd7756df-b7bc-59c3-827f-b8409313ea49",
} as const);

/** The requirement a given emitted tag evidences, or `undefined` for a tag this harness does not map. */
export function requirementIdForGateTag(gateTag: string): string | undefined {
  return (REQUIREMENT_ID_BY_GATE_TAG as Readonly<Record<string, string>>)[gateTag];
}

/**
 * A fixed, documented stand-in for "the exact release-candidate object ID"
 * — this harness's own tests run against this repo's current working
 * tree/HEAD, not a frozen release cut. A real `release-e2e` CI invocation
 * supplies the actual `git rev-parse HEAD` of the release candidate
 * instead — either via `emitReproducibleBuildEvidence`'s explicit
 * `objectId` option or, for callers that never pass one, via
 * `$CRABGIC_RELEASE_CANDIDATE_OBJECT_ID` (see
 * `resolveReleaseCandidateObjectId` below).
 */
export const FAKE_RELEASE_CANDIDATE_OBJECT_ID = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

/**
 * The object ID this harness stamps on emitted evidence when no explicit
 * `objectId` override is supplied: `$CRABGIC_RELEASE_CANDIDATE_OBJECT_ID` when
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
  const fromEnv = process.env["CRABGIC_RELEASE_CANDIDATE_OBJECT_ID"];
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
    const requirementId = requirementIdForGateTag(gateTag);
    const record: EvidenceRecord = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: randomUUID(),
      changeSetId: options.changeSetId,
      // Per-tag: this harness's two tags are two separate exit criteria. An
      // unmapped tag stays unstamped rather than borrowing a neighbouring
      // requirement's id — a wrong link is worse than none.
      ...(requirementId !== undefined ? { requirementId } : {}),
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
