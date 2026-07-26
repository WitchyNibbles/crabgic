import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EvidenceRecordSchema, type EvidenceRecord } from "@eo/contracts";
import { type AttestationCheckResult } from "./checkResult.js";
import {
  ARM64_VERIFICATION_GATE_TAG,
  DEMO_BRANCH_EVIDENCE_HANDOFF_GATE_TAG,
  FAKE_RELEASE_CANDIDATE_OBJECT_ID,
  JIRA_GRAFANA_VERSION_SUPPORT_WINDOWS_GATE_TAG,
  PERFORMANCE_CONTRACTS_GATE_TAG,
  RELEASE_DOCS_COMMITTED_GATE_TAG,
  REQUIREMENT_TRACEABILITY_GATE_TAG,
  SECURITY_REVIEW_GATE_TAG,
  emitAttestationEvidence,
  resolveReleaseCandidateObjectId,
} from "./evidence.js";
import { createTestJournal, type TestJournal } from "./testJournal.js";
import {
  readReleaseRequirements,
  requirementIdForGateTag,
  type ReleaseRequirement,
} from "./releaseRequirements.js";
import { checkArm64Verification, readArm64VerificationInput } from "./arm64Verification.js";
import {
  checkDemoBranchEvidenceHandoff,
  runDemoBranchEvidenceHandoff,
} from "./demoBranchEvidenceHandoff.js";
import { checkPerformanceContracts, runPerformanceContracts } from "./performanceContracts.js";
import { checkReleaseDocsCommitted, readReleaseDocsInput } from "./releaseDocsCommitted.js";
import {
  checkRequirementTraceability,
  readRequirementTraceabilityInput,
} from "./requirementTraceability.js";
import { checkSecurityReviewSignOff, readSecurityReviewInput } from "./securityReviewSignOff.js";
import {
  checkVersionSupportWindows,
  readVersionSupportWindowsInput,
} from "./versionSupportWindows.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * THE EMITTER. This file is what makes the seven previously-unreported
 * `RELEASE_GATE_CHECKLIST` items visible to `e2e/report`'s generator: each
 * check below runs against the REAL release candidate and journals its
 * verdict as an `EvidenceRecord` under that item's dedicated
 * `release-gate:<slug>` tag.
 *
 * WHY THE ASSERTIONS DO NOT ASSERT THE VERDICT: a check's verdict is DATA,
 * not a test outcome. If this suite went red whenever a check reported
 * FAIL, the release-evidence run would abort and the report would be
 * generated from a partial journal — the failing items would go back to
 * showing "no evidence" rather than "checked, and here is what is wrong".
 * Each test therefore asserts that the evidence was emitted CORRECTLY
 * (right tag, right object ID, schema-valid, exit status faithful to the
 * verdict) and leaves the scoring to the release-gate report. That division
 * is deliberate, and it is how every sibling harness in this phase behaves.
 */
function releaseCandidateObjectId(): string {
  const resolved = resolveReleaseCandidateObjectId();
  if (resolved !== FAKE_RELEASE_CANDIDATE_OBJECT_ID) return resolved;
  // No `$EO_RELEASE_CANDIDATE_OBJECT_ID` set (an ordinary local run): use
  // this working tree's real HEAD so emitted evidence names a genuine
  // object ID rather than the stand-in literal.
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
}

/** The release cut is happening now, so "release time" is this run's own date. */
function releaseCutDate(): string {
  return new Date().toISOString().slice(0, 10);
}

let journal: TestJournal;
let objectId: string;
let changeSetId: string;
let releaseRequirements: readonly ReleaseRequirement[];

/** Every `evidence_pointer` payload currently in the shared release journal. */
async function readJournalEvidence(): Promise<readonly EvidenceRecord[]> {
  const records: EvidenceRecord[] = [];
  for await (const entry of journal.store.queryEntries({ type: "evidence_pointer" })) {
    if (entry.type === "evidence_pointer") records.push(entry.payload);
  }
  return records;
}
const emitted: { readonly tag: string; readonly result: AttestationCheckResult }[] = [];

beforeAll(async () => {
  journal = await createTestJournal();
  objectId = releaseCandidateObjectId();
  changeSetId = randomUUID();
  releaseRequirements = readReleaseRequirements(REPO_ROOT);
});

afterAll(async () => {
  // Surfaces every verdict in the run log — a FAILing item's reasons are
  // the actionable output of this harness, and leaving them only as a
  // digest in the journal would make the release gate unactionable.
  for (const entry of emitted) {
    const summary = `${entry.tag}: ${entry.result.verdict}`;
    if (entry.result.verdict === "PASS") console.log(`[attestation] ${summary}`);
    else console.log(`[attestation] ${summary}\n    - ${entry.result.reasons.join("\n    - ")}`);
  }
  await journal.cleanup();
});

/** Emits one attestation and asserts the record is well-formed and faithful to the verdict. */
async function emitAndAssert(
  tag: string,
  command: string,
  result: AttestationCheckResult,
): Promise<EvidenceRecord> {
  // Stamp the release requirement this tag evidences, so 21's
  // `buildTraceabilityView` can actually link it. Without this the
  // traceability item can never pass, however much evidence exists.
  const requirementId = requirementIdForGateTag(releaseRequirements, tag);
  const record = await emitAttestationEvidence({
    journal: journal.store,
    changeSetId,
    gateTag: tag,
    command,
    result,
    objectId,
    ...(requirementId !== undefined ? { requirementId } : {}),
  });
  emitted.push({ tag, result });

  expect(() => EvidenceRecordSchema.parse(record)).not.toThrow();
  expect(record.gateTag).toBe(tag);
  expect(record.objectId).toBe(objectId);
  expect(record.exitStatus === 0).toBe(result.verdict === "PASS");
  expect(result.verdict === "PASS").toBe(result.reasons.length === 0);
  return record;
}

describe("release attestations — the seven previously-unreported checklist items", () => {
  it("emits security-review evidence", async () => {
    const result = checkSecurityReviewSignOff(readSecurityReviewInput(REPO_ROOT));
    await emitAndAssert(SECURITY_REVIEW_GATE_TAG, "attestation:security-review", result);
  });

  it("emits performance-contracts evidence", async () => {
    const result = checkPerformanceContracts(await runPerformanceContracts(REPO_ROOT, objectId));
    await emitAndAssert(
      PERFORMANCE_CONTRACTS_GATE_TAG,
      "attestation:performance-contracts",
      result,
    );
  });

  it("emits demo-branch-evidence-handoff evidence", async () => {
    const result = checkDemoBranchEvidenceHandoff(await runDemoBranchEvidenceHandoff(objectId));
    await emitAndAssert(
      DEMO_BRANCH_EVIDENCE_HANDOFF_GATE_TAG,
      "attestation:demo-branch-evidence-handoff",
      result,
    );
  });

  it("emits arm64-verification evidence", async () => {
    const result = checkArm64Verification(readArm64VerificationInput(REPO_ROOT, objectId));
    await emitAndAssert(ARM64_VERIFICATION_GATE_TAG, "attestation:arm64-verification", result);
  });

  it("emits jira-grafana-version-support-windows evidence", async () => {
    const result = checkVersionSupportWindows(
      readVersionSupportWindowsInput(REPO_ROOT, releaseCutDate()),
    );
    await emitAndAssert(
      JIRA_GRAFANA_VERSION_SUPPORT_WINDOWS_GATE_TAG,
      "attestation:jira-grafana-version-support-windows",
      result,
    );
  });

  it("emits release-docs-committed evidence", async () => {
    const result = checkReleaseDocsCommitted(readReleaseDocsInput(REPO_ROOT));
    await emitAndAssert(
      RELEASE_DOCS_COMMITTED_GATE_TAG,
      "attestation:release-docs-committed",
      result,
    );
  });

  /**
   * DELIBERATELY LAST, and the ordering is load-bearing — unusual for a test,
   * so it is stated rather than left implicit.
   *
   * This check MEASURES the shared journal: its linkability arithmetic asks
   * which requirements have a record carrying their id. Every other `it` in
   * this file appends one such record. Run second (as it was), it read a
   * journal containing only `security-review`, and reported the five items
   * emitted after it as `unlinkable_no_emitting_harness` — a verdict about
   * test ordering rather than about the release. That was invisible locally,
   * where the check is usually fed an already-complete journal from a prior
   * run, and only appeared in a clean CI run.
   *
   * Its OWN record is journaled after this read, which is fine: the
   * containerized binding (`release-e2e.yml`'s earlier step) already
   * journals records stamped with this criterion's requirementId through
   * 21's `bindRemoteResourceEvidence`, so the criterion links through those.
   */
  it("emits requirement-traceability evidence", async () => {
    // Fed from the SHARED release journal, so every sibling harness's
    // evidence counts toward traceability, not just this project's.
    const result = checkRequirementTraceability(
      readRequirementTraceabilityInput(REPO_ROOT, objectId, await readJournalEvidence()),
    );
    await emitAndAssert(
      REQUIREMENT_TRACEABILITY_GATE_TAG,
      "attestation:requirement-traceability",
      result,
    );
  });

  it("emitted exactly one record per checklist item, with no duplicate tags", () => {
    expect(emitted).toHaveLength(7);
    expect(new Set(emitted.map((entry) => entry.tag)).size).toBe(7);
  });

  /**
   * Pins the ordering the traceability check depends on. Moving that `it`
   * back up this file would silently return it to measuring a half-written
   * journal and reporting its siblings as having no emitting harness — a
   * verdict about test order rather than about the release, and one that
   * reproduces only in a clean run.
   */
  it("journaled requirement-traceability LAST, after every other item it measures", () => {
    expect(emitted[emitted.length - 1]?.tag).toBe(REQUIREMENT_TRACEABILITY_GATE_TAG);
  });
});
