import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@crabgic/contracts";
import type { JournalStore } from "@crabgic/journal";

/**
 * `EvidenceRecord` emission for the `@live` full-system conformance harness
 * (roadmap/23-release-hardening.md work item 7). Mirrors `e2e/matrix/
 * orchestration/src/evidence.ts`'s established pattern in this same phase
 * (plain typed-literal construction, no `@crabgic/gates` dependency — that
 * package's `emitEvidence` is typed against the closed `GateRiskTag` union,
 * which does not include this phase's own `release-gate:*` vocabulary;
 * `e2e/report/src/checklist.ts`'s own doc comment makes the same call:
 * "copied as plain string literals ... to keep this project's dependency
 * edge to exactly `@crabgic/contracts` + `@crabgic/journal`").
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
 * WHY THIS HARNESS NEEDS A MAP RATHER THAN ONE CONSTANT: unlike the matrix
 * harnesses, it emits under three tags that answer to TWO different
 * criteria. `live-conformance` and `not-implemented-sweep` are both accepted
 * by `e2e/report/src/checklist.ts`'s `quality-security-perf-learning-gates`
 * item as quality-gate evidence, while `gateway-cli-surface-complete` is the
 * dedicated tag of the zero-`NOT_IMPLEMENTED` criterion. Stamping one id
 * across all three would credit the wrong requirement.
 */
export const REQUIREMENT_ID_BY_GATE_TAG = Object.freeze({
  "release-gate:live-conformance": "e54413e1-5f35-5907-bf73-61c126275eb8",
  "release-gate:not-implemented-sweep": "e54413e1-5f35-5907-bf73-61c126275eb8",
  "release-gate:gateway-cli-surface-complete": "3de45957-aec7-5aa3-985c-39d08551e5c9",
} as const);

/** The requirement a given emitted tag evidences, or `undefined` for a tag this harness does not map. */
export function requirementIdForGateTag(gateTag: string): string | undefined {
  return (REQUIREMENT_ID_BY_GATE_TAG as Readonly<Record<string, string>>)[gateTag];
}

/**
 * A fixed, documented stand-in for "the exact release-candidate object ID"
 * — this harness's own unit/integration tests run against this repo's
 * current working tree, not a frozen release cut, so a real invocation
 * (the `release-e2e` CI job) supplies the actual `git rev-parse HEAD` of
 * the release candidate instead — either via `emitLiveConformanceEvidence`'s
 * explicit `objectId` option or, for the callers that never pass one, via
 * `$CRABGIC_RELEASE_CANDIDATE_OBJECT_ID` (see
 * `resolveReleaseCandidateObjectId` below). Mirrors
 * `e2e/matrix/orchestration/src/evidence.ts`'s identical `FAKE_RELEASE_
 * CANDIDATE_OBJECT_ID` convention.
 */
export const FAKE_RELEASE_CANDIDATE_OBJECT_ID = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

/**
 * The object ID this harness stamps on emitted evidence when no explicit
 * `objectId` override is supplied: `$CRABGIC_RELEASE_CANDIDATE_OBJECT_ID` when
 * set and non-empty (the same env-var convention `e2e/report/src/cli.ts`
 * and `e2e/matrix/connector/src/support/evidence.ts` already honor), else
 * `FAKE_RELEASE_CANDIDATE_OBJECT_ID` — so an ordinary `npm run test:e2e`
 * run is byte-identical to before this seam existed, while a real
 * release-gate run (`CRABGIC_RELEASE_GATE_JOURNAL_DIR` + this var, as
 * `.github/workflows/release-e2e.yml` drives it) accumulates evidence the
 * report generator can actually link to its `releaseCandidateObjectId`.
 *
 * Deliberately NOT cached: this is a pure env read (no subprocess), and an
 * uncached read keeps the function honest under tests that set/restore the
 * var within one process.
 */
export function resolveReleaseCandidateObjectId(): string {
  const fromEnv = process.env["CRABGIC_RELEASE_CANDIDATE_OBJECT_ID"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return FAKE_RELEASE_CANDIDATE_OBJECT_ID;
}

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
    const requirementId = requirementIdForGateTag(gateTag);
    const record: EvidenceRecord = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      id: randomUUID(),
      changeSetId: options.changeSetId,
      // Per-tag, because this harness's three tags answer to two different
      // criteria. An unmapped tag stays unstamped rather than borrowing a
      // neighbouring requirement's id — a wrong link is worse than none.
      ...(requirementId !== undefined ? { requirementId } : {}),
      command: options.command,
      exitStatus: options.exitStatus,
      toolchainFingerprint: options.toolchainFingerprint ?? "e2e/live/@live-conformance-harness@1",
      capturedAt,
      artifactDigests: options.artifactDigests !== undefined ? [...options.artifactDigests] : [],
      objectId: options.objectId ?? resolveReleaseCandidateObjectId(),
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
