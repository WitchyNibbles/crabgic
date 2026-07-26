import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@crabgic/contracts";
import type { JournalEntryInput } from "@crabgic/journal";
import { digestCheckResult, type AttestationCheckResult } from "./checkResult.js";

/**
 * `EvidenceRecord` emission for the seven `RELEASE_GATE_CHECKLIST` items
 * that no harness in this phase previously reported on. Follows the exact
 * pattern every sibling emitter in phase 23 already established
 * (`e2e/live/src/evidence.ts`, `e2e/release/src/evidence.ts`,
 * `e2e/matrix/orchestration/src/evidence.ts`): plain typed-literal
 * construction over `@crabgic/contracts` + `@crabgic/journal` only, with no
 * `@crabgic/gates` dependency — that package's `emitEvidence` is typed against
 * the closed `GateRiskTag` union, which does not include this phase's own
 * `release-gate:*` vocabulary.
 *
 * TAGS: unlike `e2e/matrix/orchestration` and `e2e/live` — both of which had
 * to document a deviation because their task-brief tag was not a
 * `requiredGateTags` member — every constant below is the EXACT dedicated
 * `release-gate:<slug>` tag `e2e/report/src/checklist.ts` already declares
 * for its item. That file's own doc comment names this wiring as the
 * outstanding carry-forward: "work items 2-10's harnesses (not built by this
 * work item) are expected to journal their release-scored `EvidenceRecord`s
 * with `gateTag` set to exactly this string once they exist. Provisional by
 * construction — documented here as a carry-forward for whichever worker
 * wires each harness's real evidence emission." This project is that worker
 * for these seven; no checklist edit is needed or made.
 */
export const SECURITY_REVIEW_GATE_TAG = "release-gate:security-review";
export const REQUIREMENT_TRACEABILITY_GATE_TAG = "release-gate:requirement-traceability";
export const PERFORMANCE_CONTRACTS_GATE_TAG = "release-gate:performance-contracts";
export const DEMO_BRANCH_EVIDENCE_HANDOFF_GATE_TAG = "release-gate:demo-branch-evidence-handoff";
export const ARM64_VERIFICATION_GATE_TAG = "release-gate:arm64-verification";
export const JIRA_GRAFANA_VERSION_SUPPORT_WINDOWS_GATE_TAG =
  "release-gate:jira-grafana-version-support-windows";
export const RELEASE_DOCS_COMMITTED_GATE_TAG = "release-gate:release-docs-committed";

/** Every tag this project emits — the seven previously-unreported checklist items, in `RELEASE_GATE_CHECKLIST` order. */
export const ATTESTATION_GATE_TAGS = [
  SECURITY_REVIEW_GATE_TAG,
  REQUIREMENT_TRACEABILITY_GATE_TAG,
  PERFORMANCE_CONTRACTS_GATE_TAG,
  DEMO_BRANCH_EVIDENCE_HANDOFF_GATE_TAG,
  ARM64_VERIFICATION_GATE_TAG,
  JIRA_GRAFANA_VERSION_SUPPORT_WINDOWS_GATE_TAG,
  RELEASE_DOCS_COMMITTED_GATE_TAG,
] as const;

/**
 * A fixed, documented stand-in for "the exact release-candidate object ID"
 * — this harness's own tests run against the working tree, not a frozen
 * release cut. A real `release-e2e` CI invocation supplies the actual
 * `git rev-parse HEAD` via `$CRABGIC_RELEASE_CANDIDATE_OBJECT_ID`. Identical
 * convention and identical literal to `e2e/live/src/evidence.ts` and
 * `e2e/release/src/evidence.ts`.
 */
export const FAKE_RELEASE_CANDIDATE_OBJECT_ID = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

/** Deliberately NOT cached: a pure env read, so a test that sets/restores the var within one process sees the truth. */
export function resolveReleaseCandidateObjectId(): string {
  const fromEnv = process.env["CRABGIC_RELEASE_CANDIDATE_OBJECT_ID"];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return FAKE_RELEASE_CANDIDATE_OBJECT_ID;
}

export interface EmitAttestationEvidenceOptions {
  /**
   * The narrowest surface this emitter needs — a real `JournalStore`
   * satisfies it, and so does an in-memory recorder in a test. The return
   * value is deliberately `unknown`: `JournalStore.appendEntry` resolves to
   * the written entry, but nothing here reads it, and depending on that
   * shape would couple this emitter to 04's return type for no gain.
   */
  readonly journal: { appendEntry: (entry: JournalEntryInput) => Promise<unknown> };
  readonly changeSetId: string;
  readonly gateTag: string;
  readonly command: string;
  readonly result: AttestationCheckResult;
  readonly objectId?: string;
  readonly toolchainFingerprint?: string;
  /**
   * The release requirement this evidence traces to
   * (`releaseRequirements.ts`). `EvidenceRecord.requirementId` is optional
   * in 02's schema and is left unset at almost every emission site in this
   * repository, which is precisely why `requirement-traceability` could
   * never link anything: 21's `buildTraceabilityView` matches evidence to a
   * requirement on this field alone. Stamping it here is what makes the
   * release's own evidence traceable.
   */
  readonly requirementId?: string;
  /** Injectable clock — overridable for deterministic tests. */
  readonly capturedAt?: () => string;
}

/**
 * Journals ONE `EvidenceRecord` (as an `evidence_pointer` entry) for a
 * completed attestation check.
 *
 * `exitStatus` is derived from the check's own verdict and is never
 * overridable by the caller. That is the point of this signature: an
 * emitter that accepted an `exitStatus` parameter would let a caller
 * journal `0` for a FAILing check and manufacture a green release gate. A
 * FAIL here always lands as a genuine non-zero exit status, and the
 * generator scores the item `FAIL` accordingly.
 */
export async function emitAttestationEvidence(
  options: EmitAttestationEvidenceOptions,
): Promise<EvidenceRecord> {
  const record: EvidenceRecord = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId: options.changeSetId,
    ...(options.requirementId !== undefined ? { requirementId: options.requirementId } : {}),
    command: options.command,
    exitStatus: options.result.verdict === "PASS" ? 0 : 1,
    toolchainFingerprint: options.toolchainFingerprint ?? "e2e/attestation@1",
    capturedAt: (options.capturedAt ?? (() => new Date().toISOString()))(),
    artifactDigests: [...digestCheckResult(options.result)],
    objectId: options.objectId ?? resolveReleaseCandidateObjectId(),
    gateTag: options.gateTag,
  };
  await options.journal.appendEntry({
    type: "evidence_pointer",
    changeSetId: options.changeSetId,
    payload: record,
  });
  return record;
}
