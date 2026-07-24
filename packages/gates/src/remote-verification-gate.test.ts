import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RUN_LIFECYCLE_STATES } from "@eo/contracts";
import { JIRA_WORKFLOW_STAGES } from "@eo/connectors-jira";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { recordEvidencePointer } from "./remote-evidence-pointer.js";
import { createRemoteVerificationGate } from "./remote-verification-gate.js";
import type { GateContext } from "./types.js";

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

function baseContext(overrides: Partial<GateContext> = {}): GateContext {
  return {
    stage: "final_verifying",
    changeSetId: randomUUID(),
    objectId: "integrated-object-id",
    journal: tj.store,
    ...overrides,
  };
}

describe("remote_verification gate — failing-first: unbound pointer fails the gate", () => {
  it("fails when a requirement declares a required RemoteResource id with NO recorded pointer", async () => {
    const requirementId = randomUUID();
    const gate = createRemoteVerificationGate({ requiredRemoteResourceIds: [randomUUID()] });
    const result = await gate(baseContext({ requirementId }));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("unbound evidence pointer");
  });
});

describe("remote_verification gate — pass path (bound pointer)", () => {
  it("passes once the required RemoteResource id has a recorded pointer", async () => {
    const requirementId = randomUUID();
    const remoteResourceId = randomUUID();
    await recordEvidencePointer(tj.store, {
      requirementId,
      remoteResourceId,
      relation: "tracking-issue",
      changeSetId: randomUUID(),
      objectId: "obj-1",
      confirmedRevision: "3",
    });
    const gate = createRemoteVerificationGate({ requiredRemoteResourceIds: [remoteResourceId] });
    const result = await gate(baseContext({ requirementId }));
    expect(result.passed).toBe(true);
    expect(result.artifactDigests).toContain(`remote-resource:${remoteResourceId}:tracking-issue`);
    // MAJOR-1 fix (adversarial-validation round): the emitted EvidenceRecord
    // (via GateVerdict.artifactDigests, 14's single emission path) must
    // literally CARRY the confirmed remote revision, not just prove a
    // pointer exists — "a run completes only when every requirement's
    // EvidenceRecord carries a confirmed remote revision" (exit criterion 1).
    expect(result.artifactDigests).toContain(`confirmed-revision:${remoteResourceId}:3`);
  });

  it("a bound pointer with NO confirmed revision yet does not emit a confirmed-revision digest for it", async () => {
    const requirementId = randomUUID();
    const remoteResourceId = randomUUID();
    await recordEvidencePointer(tj.store, {
      requirementId,
      remoteResourceId,
      relation: "tracking-issue",
      changeSetId: randomUUID(),
      objectId: "obj-1",
    });
    const gate = createRemoteVerificationGate({ requiredRemoteResourceIds: [remoteResourceId] });
    const result = await gate(baseContext({ requirementId }));
    expect(
      result.artifactDigests.some((d) => d.startsWith(`confirmed-revision:${remoteResourceId}:`)),
    ).toBe(false);
  });

  it("passes trivially when the requirement tracks nothing remote (empty requiredRemoteResourceIds)", async () => {
    const gate = createRemoteVerificationGate();
    const result = await gate(baseContext({ requirementId: randomUUID() }));
    expect(result.passed).toBe(true);
  });
});

describe("remote_verification gate — canonical-error fault matrix (never a silent pass)", () => {
  it.each(["unsupported", "ambiguous_write"] as const)(
    "blocks when connectorOutcome is canonical %s, regardless of pointer state",
    async (outcome) => {
      const requirementId = randomUUID();
      const remoteResourceId = randomUUID();
      await recordEvidencePointer(tj.store, {
        requirementId,
        remoteResourceId,
        relation: "tracking-issue",
        changeSetId: randomUUID(),
        objectId: "obj-1",
        confirmedRevision: "1",
      });
      const gate = createRemoteVerificationGate({
        requiredRemoteResourceIds: [remoteResourceId],
        connectorOutcome: outcome,
      });
      const result = await gate(baseContext({ requirementId }));
      expect(result.passed).toBe(false);
      expect(result.detail).toContain(outcome);
    },
  );

  it.each([
    "authentication",
    "permission",
    "not_found",
    "conflict",
    "rate_limited",
    "validation",
    "transient",
    "policy_blocked",
  ] as const)(
    "does NOT block on the other 8 canonical outcomes by itself (%s)",
    async (outcome) => {
      const gate = createRemoteVerificationGate({ connectorOutcome: outcome });
      const result = await gate(baseContext({ requirementId: randomUUID() }));
      expect(result.passed).toBe(true);
    },
  );
});

describe("enum-disjointness — Jira's own `done` workflow stage (18) and the Run lifecycle's final_verifying/published_local (02) share no member string", () => {
  it("JIRA_WORKFLOW_STAGES and RUN_LIFECYCLE_STATES intersect only on the unrelated, independently-documented 'blocked' spelling coincidence — never on final_verifying/published_local/done", () => {
    expect(RUN_LIFECYCLE_STATES).not.toContain("done");
    expect(JIRA_WORKFLOW_STAGES).not.toContain("final_verifying");
    expect(JIRA_WORKFLOW_STAGES).not.toContain("published_local");
    // The two closed unions are for genuinely distinct concerns; the ONLY
    // shared token between them (if any) must not be one of the states this
    // gate actually blocks/passes against.
    const shared = JIRA_WORKFLOW_STAGES.filter((s) =>
      (RUN_LIFECYCLE_STATES as readonly string[]).includes(s),
    );
    expect(shared).not.toContain("final_verifying");
    expect(shared).not.toContain("published_local");
    expect(shared).not.toContain("done");
  });
});
