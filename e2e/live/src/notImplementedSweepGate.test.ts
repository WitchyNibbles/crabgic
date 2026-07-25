import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GATEWAY_CLI_SURFACE_COMPLETE_GATE_TAG,
  NOT_IMPLEMENTED_SWEEP_GATE_TAG,
  resolveReleaseCandidateObjectId,
} from "./evidence.js";
import { KNOWN_DEFERRED_ALLOWLIST } from "./knownDeferredAllowlist.js";
import {
  runAndEmitNotImplementedSweepEvidence,
  runNotImplementedSweepGate,
} from "./notImplementedSweepGate.js";
import { createTestJournal, type TestJournal } from "./testJournal.js";

describe("runNotImplementedSweepGate — genuine integration (real dispatch, real cli-entry.ts, real MCP server)", () => {
  /**
   * Was 23 gaps with `toolsCallSupported: false`. The phase-23
   * composition-root work closed 18 of them, and this sweep is what proved
   * it: run live, it reported every newly-wired id as a STALE allowlist
   * entry until the allowlist was shrunk to match reality.
   */
  it("finds exactly the 1 remaining tracked gap and reports PASS (the allowlist matches today's live reality)", async () => {
    const result = await runNotImplementedSweepGate();

    expect(result.toolsCallSupported).toBe(true);
    expect(result.liveFindingIds).toHaveLength(1);
    expect(result.newUnlistedFindings).toEqual([]);
    expect(result.staleAllowlistEntries).toEqual([]);
    expect(result.verdict).toBe("PASS");
  });

  it("every live finding id is present in the checked-in KNOWN_DEFERRED_ALLOWLIST", async () => {
    const result = await runNotImplementedSweepGate();
    const allowlistIds = new Set(KNOWN_DEFERRED_ALLOWLIST.map((e) => e.id));
    for (const id of result.liveFindingIds) {
      expect(allowlistIds.has(id)).toBe(true);
    }
  });
});

describe("runNotImplementedSweepGate — FAIL-FIRST proof: a new, unlisted gap must fail the gate", () => {
  it("genuinely reports FAIL when the live-discovered set contains an id absent from the (deliberately shrunk) allowlist", async () => {
    // Proves the comparison logic is genuinely fail-closed, without
    // introducing an actual new production gap: pass
    // runNotImplementedSweepGate's own injectable allowlist seam a set
    // missing one real, currently-true entry ("cli.connection-capabilities") — exactly
    // what a brand-new, undocumented stub would look like to this gate.
    // The sentinel has moved twice as gaps closed: "cli.resume", then
    // "cli.learn-list", both now genuinely wired.
    const shrunkAllowlist = new Set(
      KNOWN_DEFERRED_ALLOWLIST.map((e) => e.id).filter(
        (id) => id !== "cli.connection-capabilities",
      ),
    );
    const result = await runNotImplementedSweepGate(shrunkAllowlist);
    expect(result.newUnlistedFindings).toEqual(["cli.connection-capabilities"]);
    expect(result.verdict).toBe("FAIL");
  });

  it("control: the same real findings against the real, full allowlist report PASS", async () => {
    const result = await runNotImplementedSweepGate();
    expect(result.verdict).toBe("PASS");
  });
});

describe("runAndEmitNotImplementedSweepEvidence", () => {
  let tj: TestJournal;

  beforeEach(async () => {
    tj = await createTestJournal();
  });

  afterEach(async () => {
    await tj.cleanup();
  });

  it("journals evidence under both the sweep's own tag and the checklist-matching tag when the gate PASSes", async () => {
    const changeSetId = randomUUID();
    const objectId = "1111111111111111111111111111111111111111";
    const result = await runAndEmitNotImplementedSweepEvidence({
      journal: tj.store,
      changeSetId,
      objectId,
    });
    expect(result.verdict).toBe("PASS");

    // Scoped to THIS test's own freshly-generated changeSetId, not just its
    // objectId: `objectId` here is a fixed literal, so under a shared
    // journal (`EO_RELEASE_GATE_JOURNAL_DIR`, see `./testJournal.ts`) a
    // second run's records would accumulate under the same id and this
    // exact-set assertion would break.
    const tags: string[] = [];
    const exitStatuses: number[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer", changeSetId })) {
      if (entry.type !== "evidence_pointer") continue;
      if (entry.payload.objectId !== objectId) continue;
      if (entry.payload.gateTag !== undefined) tags.push(entry.payload.gateTag);
      exitStatuses.push(entry.payload.exitStatus);
    }
    expect(tags.sort()).toEqual(
      [NOT_IMPLEMENTED_SWEEP_GATE_TAG, GATEWAY_CLI_SURFACE_COMPLETE_GATE_TAG].sort(),
    );
    expect(exitStatuses.every((s) => s === 0)).toBe(true);
  });

  it("defaults objectId to the resolved release-candidate object ID when omitted", async () => {
    const changeSetId = randomUUID();
    await runAndEmitNotImplementedSweepEvidence({ journal: tj.store, changeSetId });

    // changeSetId-scoped: an unfiltered sweep would, under a shared journal
    // (`EO_RELEASE_GATE_JOURNAL_DIR`), pick up every other harness's
    // objectIds and turn "the default was used" into a false negative.
    const objectIds: string[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer", changeSetId })) {
      if (entry.type === "evidence_pointer") objectIds.push(entry.payload.objectId);
    }
    // `resolveReleaseCandidateObjectId()`, not the bare literal: unset
    // `$EO_RELEASE_CANDIDATE_OBJECT_ID` this IS
    // "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"; under a real
    // release-gate run it is the release candidate's own object ID. Either
    // way what is under test is "the default seam was used".
    expect(new Set(objectIds)).toEqual(new Set([resolveReleaseCandidateObjectId()]));
  });

  it("journals only the sweep's own tag (never the checklist-matching tag) and exitStatus 1 when the gate FAILs", async () => {
    const changeSetId = randomUUID();
    const objectId = "2222222222222222222222222222222222222222";
    const shrunkAllowlist = new Set(
      KNOWN_DEFERRED_ALLOWLIST.map((e) => e.id).filter(
        (id) => id !== "cli.connection-capabilities",
      ),
    );
    const result = await runAndEmitNotImplementedSweepEvidence({
      journal: tj.store,
      changeSetId,
      objectId,
      allowlistIds: shrunkAllowlist,
    });
    expect(result.verdict).toBe("FAIL");

    // changeSetId-scoped for the same reason as the PASS case above: the
    // literal `objectId` alone does not isolate this test's own records
    // from a shared journal's accumulated contents.
    const tags: string[] = [];
    const exitStatuses: number[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer", changeSetId })) {
      if (entry.type !== "evidence_pointer") continue;
      if (entry.payload.objectId !== objectId) continue;
      if (entry.payload.gateTag !== undefined) tags.push(entry.payload.gateTag);
      exitStatuses.push(entry.payload.exitStatus);
    }
    expect(tags).toEqual([NOT_IMPLEMENTED_SWEEP_GATE_TAG]);
    expect(exitStatuses).toEqual([1]);
  });
});
