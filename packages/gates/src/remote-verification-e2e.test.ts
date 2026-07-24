import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JiraFieldMetadata } from "@eo/connectors-jira";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry, type GateRegistry } from "./registry.js";
import { allGatesPassed } from "./final-candidate.js";
import { recordEvidencePointer } from "./remote-evidence-pointer.js";
import { createRemoteVerificationGate } from "./remote-verification-gate.js";
import { buildJiraFieldDiffs } from "./materiality-jira-adapter.js";
import { buildMaterialAmendmentSignal } from "./materiality-classifier.js";
import {
  MaterialAmendmentDetectedError,
  throwIfMaterialAmendment,
} from "./material-amendment-guard.js";
import type { GateContext } from "./types.js";

/**
 * MAJOR-1 fix (adversarial-validation round) — the real, run-shaped
 * integration proof the roadmap's exit criterion 1 itself names:
 * "E2E on fakes: a run completes only when every requirement's
 * EvidenceRecord carries a confirmed remote revision; a seeded mid-run
 * tracked-field edit halts the run via 11's material amendment stop
 * condition before final_verifying. Evidence: integration suite in
 * packages/gates + the halted run's journal excerpt."
 *
 * This fires the `remote_verification` gate THROUGH 14's real
 * `GateRegistry` (never calling the handler directly), against a real
 * `@eo/journal` `JournalStore`, for a multi-requirement fixture `ChangeSet`
 * — giving every phase-21 unit (`recordEvidencePointer`,
 * `createRemoteVerificationGate`, `classifyMateriality`,
 * `buildMaterialAmendmentSignal`, `throwIfMaterialAmendment`) a REAL,
 * run-shaped caller, not just its own unit test.
 */

let tj: TestJournal;
let registry: GateRegistry;

const CHANGE_SET_ID = "60000000-0000-4000-8000-0000000000e2";

beforeEach(async () => {
  tj = await createTestJournal();
  registry = createGateRegistry();
});

afterEach(async () => {
  await tj.cleanup();
});

function finalVerifyingContext(requirementId: string, objectId: string): GateContext {
  return {
    stage: "final_verifying",
    changeSetId: CHANGE_SET_ID,
    objectId,
    requirementId,
    journal: tj.store,
  };
}

describe("E2E — remote_verification fired THROUGH the real GateRegistry for a multi-requirement ChangeSet", () => {
  it("a run completes (every requirement's gate PASSES) only once every tracked requirement's EvidenceRecord carries a confirmed remote revision", async () => {
    const req1 = "10000000-0000-4000-8000-0000000000e1"; // Jira-tracked, bound + confirmed from the start
    const req2 = "10000000-0000-4000-8000-0000000000e2"; // Jira-tracked, starts UNBOUND
    const req3 = "10000000-0000-4000-8000-0000000000e3"; // untracked (nothing remote) — always passes trivially

    const remote1 = "20000000-0000-4000-8000-0000000000e1";
    const remote2 = "20000000-0000-4000-8000-0000000000e2";

    // One gate REGISTRATION for the whole run — the per-requirement
    // resolver functions are what let it correctly handle every
    // requirement's own required RemoteResource id(s) (MAJOR-1 fix).
    const requiredByRequirement = new Map<string, readonly string[]>([
      [req1, [remote1]],
      [req2, [remote2]],
    ]);
    registry.register(
      "security",
      "remote_verification",
      createRemoteVerificationGate({
        requiredRemoteResourceIds: (requirementId) =>
          (requirementId !== undefined ? requiredByRequirement.get(requirementId) : undefined) ??
          [],
      }),
    );

    // req1 is bound + confirmed BEFORE this run starts.
    await recordEvidencePointer(tj.store, {
      requirementId: req1,
      remoteResourceId: remote1,
      relation: "tracking-issue",
      changeSetId: CHANGE_SET_ID,
      objectId: "object-req1",
      confirmedRevision: "7",
    });

    // FIRST PASS: req2 is still unbound -> the run does NOT complete.
    const firstRun = await Promise.all([
      registry.fireByTag("security", finalVerifyingContext(req1, "object-req1")),
      registry.fireByTag("security", finalVerifyingContext(req2, "object-req2")),
      registry.fireByTag("security", finalVerifyingContext(req3, "object-req3")),
    ]);
    const firstResults = firstRun.flat();
    expect(allGatesPassed(firstResults)).toBe(false);
    expect(
      firstResults.find((r) => r.name === "remote_verification")?.verdict.passed,
    ).toBeDefined();

    const req1Result = (
      await registry.fireByTag("security", finalVerifyingContext(req1, "object-req1"))
    )[0];
    const req2Result = (
      await registry.fireByTag("security", finalVerifyingContext(req2, "object-req2"))
    )[0];
    const req3Result = (
      await registry.fireByTag("security", finalVerifyingContext(req3, "object-req3"))
    )[0];
    expect(req1Result?.verdict.passed).toBe(true);
    expect(req2Result?.verdict.passed).toBe(false); // unbound -> blocks final_verifying->published_local
    expect(req3Result?.verdict.passed).toBe(true); // nothing tracked -> trivial pass

    // req1's EvidenceRecord already carries the confirmed revision.
    expect(req1Result?.evidence.artifactDigests).toContain(`confirmed-revision:${remote1}:7`);

    // NOW resolve req2: 18/20 confirm the read-back revision -> record the pointer.
    await recordEvidencePointer(tj.store, {
      requirementId: req2,
      remoteResourceId: remote2,
      relation: "tracking-issue",
      changeSetId: CHANGE_SET_ID,
      objectId: "object-req2",
      confirmedRevision: "3",
    });

    // SECOND PASS: every requirement's EvidenceRecord now carries a
    // confirmed remote revision -> the run completes.
    const secondRun = await Promise.all([
      registry.fireByTag("security", finalVerifyingContext(req1, "object-req1")),
      registry.fireByTag("security", finalVerifyingContext(req2, "object-req2")),
      registry.fireByTag("security", finalVerifyingContext(req3, "object-req3")),
    ]);
    const secondResults = secondRun.flat();
    expect(allGatesPassed(secondResults)).toBe(true);
    const req2FinalEvidence = secondResults.find(
      (r) => r.evidence.requirementId === req2 && r.evidence.objectId === "object-req2",
    );
    expect(req2FinalEvidence?.evidence.artifactDigests).toContain(
      `confirmed-revision:${remote2}:3`,
    );

    // JOURNAL EXCERPT (this criterion's own named evidence artifact) —
    // every evidence_pointer entry this run produced, in append order.
    const journalExcerpt: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      journalExcerpt.push(entry);
    }
    expect(journalExcerpt.length).toBeGreaterThan(0);
    // At least one entry proves req2's eventual bound-and-confirmed state
    // durably landed in the journal (not just in-memory across this test).
    expect(
      journalExcerpt.some(
        (e) =>
          (e as { payload: { requirementId?: string; artifactDigests: readonly string[] } }).payload
            .requirementId === req2 &&
          (
            e as { payload: { artifactDigests: readonly string[] } }
          ).payload.artifactDigests.includes(`confirmed-revision:${remote2}:3`),
      ),
    ).toBe(true);
  });

  it("unsupported/ambiguous_write connector outcomes block final_verifying->published_local through the SAME real registry, per requirement, never a silent pass", async () => {
    const reqUnsupported = "10000000-0000-4000-8000-0000000000f1";
    const reqAmbiguous = "10000000-0000-4000-8000-0000000000f2";
    const reqClean = "10000000-0000-4000-8000-0000000000f3";

    const outcomeByRequirement = new Map<string, "unsupported" | "ambiguous_write">([
      [reqUnsupported, "unsupported"],
      [reqAmbiguous, "ambiguous_write"],
    ]);
    registry.register(
      "security",
      "remote_verification",
      createRemoteVerificationGate({
        connectorOutcome: (requirementId) =>
          requirementId !== undefined ? outcomeByRequirement.get(requirementId) : undefined,
      }),
    );

    const results = await Promise.all([
      registry.fireByTag("security", finalVerifyingContext(reqUnsupported, "obj-1")),
      registry.fireByTag("security", finalVerifyingContext(reqAmbiguous, "obj-2")),
      registry.fireByTag("security", finalVerifyingContext(reqClean, "obj-3")),
    ]);
    const [unsupportedResult, ambiguousResult, cleanResult] = results.map((r) => r[0]);

    expect(unsupportedResult?.verdict.passed).toBe(false);
    expect(unsupportedResult?.verdict.detail).toContain("unsupported");
    expect(ambiguousResult?.verdict.passed).toBe(false);
    expect(ambiguousResult?.verdict.detail).toContain("ambiguous_write");
    expect(cleanResult?.verdict.passed).toBe(true);
    expect(allGatesPassed(results.flat())).toBe(false);
  });
});

describe("E2E — a seeded mid-run material field edit halts BEFORE final_verifying completes", () => {
  it("classifyMateriality (fed 18's real customfield-id diff shape) -> buildMaterialAmendmentSignal -> throwIfMaterialAmendment halts before the requirement's final_verifying gate ever fires", async () => {
    const requirementId = "10000000-0000-4000-8000-0000000000f4";
    const remoteResourceId = "20000000-0000-4000-8000-0000000000f4";

    // The requirement starts bound + confirmed — final_verifying WOULD pass
    // if reached.
    await recordEvidencePointer(tj.store, {
      requirementId,
      remoteResourceId,
      relation: "tracking-issue",
      changeSetId: CHANGE_SET_ID,
      objectId: "object-f4",
      confirmedRevision: "1",
    });
    registry.register(
      "security",
      "remote_verification",
      createRemoteVerificationGate({ requiredRemoteResourceIds: [remoteResourceId] }),
    );

    // A mid-run poll observes a real Jira acceptance-criteria edit, arriving
    // under its ACTUAL custom-field id — never the literal string
    // "acceptance-criteria" (closes the false-negative direction).
    const fieldMetadata: readonly JiraFieldMetadata[] = [
      { id: "customfield_10057", name: "Acceptance Criteria", custom: true, schemaType: "string" },
    ];
    const diffs = buildJiraFieldDiffs(
      { customfield_10057: "Given X, when Y, then Z (v1)" },
      { customfield_10057: "Given X, when Y, then Z' (v2 — materially different)" },
      fieldMetadata,
    );
    const signal = buildMaterialAmendmentSignal(requirementId, diffs);
    expect(signal.material).toBe(true);
    expect(signal.materialFields).toEqual(["acceptance-criteria"]);

    let finalVerifyingGateFired = false;
    const runToFinalVerifying = async (): Promise<void> => {
      // This is exactly the trigger signal 11's real stop condition
      // consumes (21 supplies the signal; 11 owns the amendment/
      // re-approval mechanics, reached transitively 21->14->13->11) — this
      // typed throw is this phase's own minimal, testable proof that the
      // signal WOULD halt the run right here, before final_verifying.
      throwIfMaterialAmendment(signal);
      finalVerifyingGateFired = true;
      await registry.fireByTag("security", finalVerifyingContext(requirementId, "object-f4"));
    };

    await expect(runToFinalVerifying()).rejects.toThrow(MaterialAmendmentDetectedError);
    expect(finalVerifyingGateFired).toBe(false);

    // Sanity check: had the material edit NOT interrupted the run, this
    // requirement's final_verifying gate WOULD have passed (proving the
    // halt is a genuine "would otherwise proceed" case, not a gate that was
    // going to block anyway).
    const wouldHavePassed = await registry.fireByTag(
      "security",
      finalVerifyingContext(requirementId, "object-f4"),
    );
    expect(wouldHavePassed[0]?.verdict.passed).toBe(true);
  });

  it("a non-tracked-field-only mid-run edit (e.g. Jira watchers) does NOT halt — final_verifying proceeds normally", async () => {
    const requirementId = "10000000-0000-4000-8000-0000000000f5";
    const remoteResourceId = "20000000-0000-4000-8000-0000000000f5";
    await recordEvidencePointer(tj.store, {
      requirementId,
      remoteResourceId,
      relation: "tracking-issue",
      changeSetId: CHANGE_SET_ID,
      objectId: "object-f5",
      confirmedRevision: "1",
    });
    registry.register(
      "security",
      "remote_verification",
      createRemoteVerificationGate({ requiredRemoteResourceIds: [remoteResourceId] }),
    );

    const fieldMetadata: readonly JiraFieldMetadata[] = [
      { id: "customfield_10200", name: "Watchers Extra", custom: true, schemaType: "array" },
    ];
    const diffs = buildJiraFieldDiffs(
      { customfield_10200: "[alice]" },
      { customfield_10200: "[alice,bob]" },
      fieldMetadata,
    );
    const signal = buildMaterialAmendmentSignal(requirementId, diffs);
    expect(signal.material).toBe(false);

    let finalVerifyingGateFired = false;
    const runToFinalVerifying = async (): Promise<void> => {
      throwIfMaterialAmendment(signal);
      finalVerifyingGateFired = true;
      await registry.fireByTag("security", finalVerifyingContext(requirementId, "object-f5"));
    };

    await expect(runToFinalVerifying()).resolves.toBeUndefined();
    expect(finalVerifyingGateFired).toBe(true);
  });
});
