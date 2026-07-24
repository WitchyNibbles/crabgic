import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import {
  findRemoteResourcePointersForRequirement,
  findRequirementsForRemoteResource,
  recordEvidencePointer,
} from "./remote-evidence-pointer.js";

/**
 * roadmap/21-connector-evidence-integration.md work item 1: "a lookup
 * against an empty journal must return empty, not throw — written before
 * the writer exists." §Test plan, Unit: "seed 3 requirements (2
 * Jira-tracked, 1 Grafana-tracked); bidirectional requirement↔RemoteResource
 * lookup resolves both directions; an untracked requirement returns empty,
 * not an error."
 */

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("findRemoteResourcePointersForRequirement — failing-first: empty journal", () => {
  it("returns [] against a completely empty journal, never throws", async () => {
    await expect(findRemoteResourcePointersForRequirement(tj.store, randomUUID())).resolves.toEqual(
      [],
    );
  });

  it("returns [] for an untracked requirement even once OTHER requirements have pointers", async () => {
    const changeSetId = randomUUID();
    const trackedRequirementId = randomUUID();
    const untrackedRequirementId = randomUUID();
    await recordEvidencePointer(tj.store, {
      requirementId: trackedRequirementId,
      remoteResourceId: randomUUID(),
      relation: "tracking-issue",
      changeSetId,
      objectId: "obj-1",
    });
    await expect(
      findRemoteResourcePointersForRequirement(tj.store, untrackedRequirementId),
    ).resolves.toEqual([]);
  });
});

describe("findRequirementsForRemoteResource — failing-first: empty journal", () => {
  it("returns [] against a completely empty journal, never throws", async () => {
    await expect(findRequirementsForRemoteResource(tj.store, randomUUID())).resolves.toEqual([]);
  });
});

describe("findRemoteResourcePointersForRequirement / findRequirementsForRemoteResource — ignore ordinary (non-pointer) evidence_pointer entries", () => {
  it("an ordinary gate-firing EvidenceRecord for the same requirement (not this module's pointer-command encoding) is skipped, not misread as a pointer", async () => {
    const requirementId = randomUUID();
    const changeSetId = randomUUID();
    // A plain 14-style gate-firing evidence_pointer entry — `command` is an
    // ordinary shell command, not this module's `remote-resource-pointer:`
    // encoding, and it targets the SAME requirementId a real pointer might.
    await tj.store.appendEntry({
      type: "evidence_pointer",
      changeSetId,
      payload: {
        schemaVersion: 1,
        id: randomUUID(),
        changeSetId,
        requirementId,
        command: "npm test",
        exitStatus: 0,
        toolchainFingerprint: "node@24",
        capturedAt: new Date().toISOString(),
        artifactDigests: [],
        objectId: "obj-ordinary",
        gateTag: "tdd",
      },
    });

    await expect(
      findRemoteResourcePointersForRequirement(tj.store, requirementId),
    ).resolves.toEqual([]);
  });

  // MINOR-2 (adversarial-validation round): the doc comment (file header)
  // advertises `gateTag === "remote_verification"` as a fixed marker
  // alongside the `command` prefix, but the reader must actually CHECK it —
  // an adjacent writer that happens to emit a colliding `command` prefix
  // under a DIFFERENT `gateTag` must not be misread as a real connector
  // pointer. Failing-first: this currently returns the bogus entry as a
  // pointer.
  it("an entry whose command matches the pointer-encoding prefix but whose gateTag is NOT remote_verification is rejected, not misread as a pointer", async () => {
    const requirementId = randomUUID();
    const changeSetId = randomUUID();
    await tj.store.appendEntry({
      type: "evidence_pointer",
      changeSetId,
      payload: {
        schemaVersion: 1,
        id: randomUUID(),
        changeSetId,
        requirementId,
        command: "remote-resource-pointer:tracking-issue:00000000-0000-4000-8000-000000009999",
        exitStatus: 0,
        toolchainFingerprint: "unrelated-writer@1",
        capturedAt: new Date().toISOString(),
        artifactDigests: [],
        objectId: "obj-collision",
        gateTag: "some-other-gate",
      },
    });

    await expect(
      findRemoteResourcePointersForRequirement(tj.store, requirementId),
    ).resolves.toEqual([]);
  });
});

describe("bidirectional requirement <-> RemoteResource pointer round-trip (3 requirements: 2 Jira, 1 Grafana)", () => {
  it("resolves forward (requirement -> RemoteResource) and reverse (RemoteResource -> requirement) for every tracked requirement", async () => {
    const changeSetId = randomUUID();
    const req1 = randomUUID(); // Jira-tracked (tracking-issue)
    const req2 = randomUUID(); // Jira-tracked (tracking-issue)
    const req3 = randomUUID(); // Grafana-tracked (dashboard)
    const remote1 = randomUUID();
    const remote2 = randomUUID();
    const remote3 = randomUUID();

    await recordEvidencePointer(tj.store, {
      requirementId: req1,
      remoteResourceId: remote1,
      relation: "tracking-issue",
      changeSetId,
      objectId: "obj-1",
      confirmedRevision: "7",
    });
    await recordEvidencePointer(tj.store, {
      requirementId: req2,
      remoteResourceId: remote2,
      relation: "tracking-issue",
      changeSetId,
      objectId: "obj-2",
    });
    await recordEvidencePointer(tj.store, {
      requirementId: req3,
      remoteResourceId: remote3,
      relation: "dashboard",
      changeSetId,
      objectId: "obj-3",
      confirmedRevision: "etag-9",
    });

    // FORWARD
    const forward1 = await findRemoteResourcePointersForRequirement(tj.store, req1);
    expect(forward1).toHaveLength(1);
    expect(forward1[0]?.remoteResourceId).toBe(remote1);
    expect(forward1[0]?.relation).toBe("tracking-issue");
    expect(forward1[0]?.confirmedRevision).toBe("7");

    const forward3 = await findRemoteResourcePointersForRequirement(tj.store, req3);
    expect(forward3).toHaveLength(1);
    expect(forward3[0]?.relation).toBe("dashboard");
    expect(forward3[0]?.confirmedRevision).toBe("etag-9");

    // REVERSE
    const reverse2 = await findRequirementsForRemoteResource(tj.store, remote2);
    expect(reverse2).toHaveLength(1);
    expect(reverse2[0]?.requirementId).toBe(req2);
    expect(reverse2[0]?.confirmedRevision).toBeUndefined();

    const reverse3 = await findRequirementsForRemoteResource(tj.store, remote3);
    expect(reverse3).toHaveLength(1);
    expect(reverse3[0]?.requirementId).toBe(req3);
  });
});
