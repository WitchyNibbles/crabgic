import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, getLatestAttempt, type JournalStore } from "@eo/journal";
import {
  buildAuthorizationEnvelope,
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  buildWorkUnit,
  FakeEngineAdapter,
  RATE_LIMIT_ALLOWED_WARNING_96,
} from "@eo/testkit";
import { compileEnvelope } from "@eo/engine-core";
import type { CollisionVerdict } from "@eo/git-engine";
import type { SessionRef } from "@eo/engine-core";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";
import { computeReadyUnits } from "./readiness.js";
import {
  DEFAULT_CONCURRENCY_CAP,
  journalFanoutRationaleIfFannedOut,
  selectDispatchSet,
} from "./fanout.js";
import { dispatchAttempt, resumeAttempt } from "./executor.js";
import { getParkStatus } from "./parking.js";
import { runShadowAttempt } from "./shadow-run.js";
import { ArtifactStore } from "./artifact-store.js";
import { SchedulerCache } from "./cache.js";
import { RepairEvidenceRequiredError } from "./errors.js";

/**
 * Fake-engine E2E — roadmap/13-scheduler-packets-context.md §Work items 7:
 * "Fake-engine E2E covering the full arc (3-unit DAG w/ forced overlap,
 * crash→repair, limit-park→resume across simulated supervisor restart,
 * shadow-run isolation)."
 */

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const C = "cccccccc-0000-4000-8000-00000000000c";
const D = "dddddddd-0000-4000-8000-00000000000d";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-scheduler-e2e-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("E2E: 3-unit DAG with forced overlap (two serialize, one proceeds independently)", () => {
  it("dispatches the independent unit alongside one of the overlapping pair, then serializes the other into a later round", async () => {
    const overlapVerdicts: CollisionVerdict[] = [
      {
        unitA: A,
        unitB: B,
        collides: true,
        collidingPaths: ["shared.ts"],
        declaredResourceCollisions: [],
      },
      { unitA: A, unitB: C, collides: false, collidingPaths: [], declaredResourceCollisions: [] },
      { unitA: B, unitB: C, collides: false, collidingPaths: [], declaredResourceCollisions: [] },
    ];

    // Round 1: all three are ready (no deps). A/B collide; C is independent.
    const workUnits = [
      buildWorkUnit({ id: A, dependsOn: [], attemptStatus: "pending" }),
      buildWorkUnit({ id: B, dependsOn: [], attemptStatus: "pending" }),
      buildWorkUnit({ id: C, dependsOn: [], attemptStatus: "pending" }),
    ];
    const ready = computeReadyUnits({ workUnits, overlapVerdicts: overlapVerdicts });
    expect(ready).toEqual([A, B, C]);

    const round1Ready = ready;
    const round1Selected = selectDispatchSet(round1Ready, overlapVerdicts, DEFAULT_CONCURRENCY_CAP);
    expect(round1Selected).toEqual([A, C]); // B serialized out of round 1

    await journalFanoutRationaleIfFannedOut({ journal: store, dispatchedUnitIds: round1Selected });
    const fanoutEntries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "fanout_rationale" }))
      fanoutEntries.push(entry);
    expect(fanoutEntries).toHaveLength(1); // fan-out journaled for the 2-unit round only

    // Dispatch A and C concurrently this round.
    const adapterA = new FakeEngineAdapter(
      buildFakeEngineScript({
        sessionId: "10000000-0000-4000-8000-000000000001",
        structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
      }),
    );
    const adapterC = new FakeEngineAdapter(
      buildFakeEngineScript({
        sessionId: "10000000-0000-4000-8000-000000000003",
        structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
      }),
    );
    const [outcomeA, outcomeC] = await Promise.all([
      dispatchAttempt({
        adapter: adapterA,
        journal: store,
        packet: buildTaskPacket({ workUnitId: A }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: "none",
      }),
      dispatchAttempt({
        adapter: adapterC,
        journal: store,
        packet: buildTaskPacket({ workUnitId: C }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: "none",
      }),
    ]);
    expect(outcomeA.kind).toBe("succeeded");
    expect(outcomeC.kind).toBe("succeeded");

    // Round 2: A has succeeded, so B (no longer overlap-blocked by an
    // in-flight A) is now ready and dispatches ALONE — no fan-out entry.
    const round2Selected = selectDispatchSet([B], overlapVerdicts, DEFAULT_CONCURRENCY_CAP);
    expect(round2Selected).toEqual([B]);
    await journalFanoutRationaleIfFannedOut({ journal: store, dispatchedUnitIds: round2Selected });

    const adapterB = new FakeEngineAdapter(
      buildFakeEngineScript({
        sessionId: "10000000-0000-4000-8000-000000000002",
        structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
      }),
    );
    const outcomeB = await dispatchAttempt({
      adapter: adapterB,
      journal: store,
      packet: buildTaskPacket({ workUnitId: B }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcomeB.kind).toBe("succeeded");

    // Still exactly ONE fanout_rationale entry — B's solo round never fanned out.
    const fanoutEntriesAfter: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "fanout_rationale" }))
      fanoutEntriesAfter.push(entry);
    expect(fanoutEntriesAfter).toHaveLength(1);

    expect((await getLatestAttempt(store, A))?.status).toBe("succeeded");
    expect((await getLatestAttempt(store, B))?.status).toBe("succeeded");
    expect((await getLatestAttempt(store, C))?.status).toBe("succeeded");
  });
});

describe("E2E: crash mid-attempt → repair with fresh diagnostic evidence", () => {
  it("crashes, is allowed a repair with 'crash' evidence, and resumes the SAME session to success", async () => {
    const sessionId = "20000000-0000-4000-8000-000000000001";
    const repairScript = buildFakeEngineScript({
      sessionId,
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const crashScript = buildFakeEngineScript({
      sessionId,
      failure: { kind: "crash", atStepIndex: 0 },
      onResume: repairScript,
    });
    const adapter = new FakeEngineAdapter(crashScript);

    const initialOutcome = await dispatchAttempt({
      adapter,
      journal: store,
      packet: buildTaskPacket({ workUnitId: D }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none", // first attempt — no evidence required
    });
    expect(initialOutcome).toMatchObject({ kind: "crashed", evidenceKind: "crash" });

    const sessionRef: SessionRef = {
      sessionId,
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    };
    // MAJOR-1 fix: the crash IS valid "new diagnostic evidence" for a
    // repair, and this repair genuinely ROUTES THROUGH resumeAttempt's own
    // `trigger: {kind: "crashRepair"}` gate — not a bare side-assertion
    // sitting beside an ungated call. If the cap/evidence check were ever
    // bypassed again, THIS call itself would proceed incorrectly (proven
    // it does not, in the dedicated cap-exhaustion test below).
    const repairOutcome = await resumeAttempt({
      adapter,
      journal: store,
      sessionRef,
      workUnitId: D,
      adjudicate: allowAllAdjudicate,
      trigger: { kind: "crashRepair", evidenceKind: "crash" },
    });
    expect(repairOutcome).toMatchObject({ kind: "succeeded", sessionId });
    expect((await getLatestAttempt(store, D))?.status).toBe("succeeded");
  });

  it("MAJOR-1: a resumeAttempt crashRepair is REFUSED once the cap is exhausted — the gate actually blocks the call, not a side assertion", async () => {
    const workUnitId = "66666666-0000-4000-8000-000000000abc";
    // Exhaust the cap via 3 real dispatchAttempt-driven failures.
    for (let i = 0; i < 3; i++) {
      const script = buildFakeEngineScript({
        structuredOutput: buildWorkerResult({ outcome: "failed", diagnostics: [`f${String(i)}`] }),
      });
      await dispatchAttempt({
        adapter: new FakeEngineAdapter(script),
        journal: store,
        packet: buildTaskPacket({ workUnitId }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: i === 0 ? "none" : "workerResultFailure",
      });
    }

    const sessionId = "77777777-0000-4000-8000-00000000ab77";
    const adapter = new FakeEngineAdapter(buildFakeEngineScript({ sessionId }));
    let resumeCalled = false;
    const originalResume = adapter.resume.bind(adapter);
    adapter.resume = (...args) => {
      resumeCalled = true;
      return originalResume(...args);
    };
    const sessionRef: SessionRef = {
      sessionId,
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    };

    await expect(
      resumeAttempt({
        adapter,
        journal: store,
        sessionRef,
        workUnitId,
        adjudicate: allowAllAdjudicate,
        trigger: { kind: "crashRepair", evidenceKind: "crash" },
      }),
    ).rejects.toThrow(RepairEvidenceRequiredError);
    // The gate genuinely blocked the call BEFORE any engine interaction.
    expect(resumeCalled).toBe(false);
  });

  it("refuses a 3rd dispatch attempt WITHOUT new evidence with a TYPED error, via dispatchAttempt itself", async () => {
    const workUnitId = "33333333-0000-4000-8000-000000000000";
    // Two prior dispatch/failed cycles recorded directly (simulating two
    // already-completed repair attempts).
    const failScript1 = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "failed", diagnostics: ["first failure"] }),
    });
    const failScript2 = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "failed", diagnostics: ["second failure"] }),
    });
    await dispatchAttempt({
      adapter: new FakeEngineAdapter(failScript1),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    await dispatchAttempt({
      adapter: new FakeEngineAdapter(failScript2),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "workerResultFailure",
    });

    // A 3rd dispatch attempt WITHOUT citing new evidence is refused before
    // ever reaching the engine adapter.
    let spawnCalled = false;
    const thirdScript = buildFakeEngineScript();
    const thirdAdapter = new FakeEngineAdapter(thirdScript);
    const originalSpawn = thirdAdapter.spawn.bind(thirdAdapter);
    thirdAdapter.spawn = (...args) => {
      spawnCalled = true;
      return originalSpawn(...args);
    };

    await expect(
      dispatchAttempt({
        adapter: thirdAdapter,
        journal: store,
        packet: buildTaskPacket({ workUnitId }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: "none",
      }),
    ).rejects.toThrow(RepairEvidenceRequiredError);
    expect(spawnCalled).toBe(false);

    // ... but WITH fresh evidence, the 3rd (final) attempt is allowed.
    const thirdOutcome = await dispatchAttempt({
      adapter: thirdAdapter,
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "workerResultFailure",
    });
    expect(thirdOutcome.kind).toBe("succeeded");

    // A would-be 4th attempt is refused REGARDLESS of evidence — the cap is absolute.
    await expect(
      dispatchAttempt({
        adapter: thirdAdapter,
        journal: store,
        packet: buildTaskPacket({ workUnitId }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: "workerResultFailure",
      }),
    ).rejects.toThrow(RepairEvidenceRequiredError);
  });

  it("a schema-violation failure counts as valid repair evidence exactly once — it justifies ONE repair, never more toward the cap", async () => {
    const workUnitId = "44444444-0000-4000-8000-000000000000";
    const violatingScript = buildFakeEngineScript({ failure: { kind: "schemaViolation" } });
    const outcome1 = await dispatchAttempt({
      adapter: new FakeEngineAdapter(violatingScript),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome1).toMatchObject({ kind: "failed", evidenceKind: "schemaViolation" });

    // Repair 1, citing the schema-violation evidence — allowed.
    const outcome2 = await dispatchAttempt({
      adapter: new FakeEngineAdapter(violatingScript),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "schemaViolation",
    });
    expect(outcome2).toMatchObject({ kind: "failed", evidenceKind: "schemaViolation" });

    // Repair 2 (3rd total dispatch), citing the SAME evidence kind again —
    // still allowed (this is the 2nd repair, cap not yet reached).
    const outcome3 = await dispatchAttempt({
      adapter: new FakeEngineAdapter(violatingScript),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "schemaViolation",
    });
    expect(outcome3).toMatchObject({ kind: "failed", evidenceKind: "schemaViolation" });

    // A 4th dispatch, even citing the identical evidence kind yet again, is
    // refused — citing the same evidence repeatedly never grants extra
    // repairs beyond the absolute 1-initial+2-repairs cap.
    await expect(
      dispatchAttempt({
        adapter: new FakeEngineAdapter(violatingScript),
        journal: store,
        packet: buildTaskPacket({ workUnitId }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: "schemaViolation",
      }),
    ).rejects.toThrow(RepairEvidenceRequiredError);
  });
});

describe("E2E: limit-signal → park → simulated clock past reset → resume, surviving a simulated supervisor restart", () => {
  it("parks on limitSignal, then resumes with the SAME session_id after a fresh JournalStore instance (simulated restart) sees the clock has passed the reset", async () => {
    const sessionId = "50000000-0000-4000-8000-000000000001";
    const resumeScript = buildFakeEngineScript({
      sessionId,
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const parkScript = buildFakeEngineScript({
      sessionId,
      failure: { kind: "limitSignal", payload: RATE_LIMIT_ALLOWED_WARNING_96 },
      onResume: resumeScript,
    });
    const adapter = new FakeEngineAdapter(parkScript);
    const workUnitId = "55555555-0000-4000-8000-000000000000";

    const parkOutcome = await dispatchAttempt({
      adapter,
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(parkOutcome).toMatchObject({ kind: "parked" });

    // Simulated supervisor restart: brand-new JournalStore instance over
    // the identical on-disk journalDir — zero in-memory state carried over.
    const freshStore = createJournalStore({ journalDir });
    const beforeReset = await getParkStatus(
      freshStore,
      workUnitId,
      RATE_LIMIT_ALLOWED_WARNING_96.resetsAt - 1,
    );
    expect(beforeReset).toMatchObject({ parked: true, readyToResume: false });

    const afterReset = await getParkStatus(
      freshStore,
      workUnitId,
      RATE_LIMIT_ALLOWED_WARNING_96.resetsAt + 1,
    );
    expect(afterReset).toMatchObject({ parked: true, readyToResume: true, sessionId });

    const sessionRef: SessionRef = {
      sessionId,
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    };
    const resumeOutcome = await resumeAttempt({
      adapter,
      journal: freshStore,
      sessionRef,
      workUnitId,
      adjudicate: allowAllAdjudicate,
      trigger: { kind: "parkResume" },
    });
    expect(resumeOutcome).toMatchObject({ kind: "succeeded", sessionId });

    const finalStatus = await getParkStatus(
      freshStore,
      workUnitId,
      RATE_LIMIT_ALLOWED_WARNING_96.resetsAt + 100,
    );
    expect(finalStatus.parked).toBe(false);
  });

  it("two concurrently-parked work units from the same project never collide on a session_id", async () => {
    const sessionG = "60000000-0000-4000-8000-000000000001";
    const sessionH = "60000000-0000-4000-8000-000000000002";
    const workUnitG = "66666666-0000-4000-8000-000000000001";
    const workUnitH = "66666666-0000-4000-8000-000000000002";

    await dispatchAttempt({
      adapter: new FakeEngineAdapter(
        buildFakeEngineScript({
          sessionId: sessionG,
          failure: { kind: "limitSignal", payload: RATE_LIMIT_ALLOWED_WARNING_96 },
        }),
      ),
      journal: store,
      packet: buildTaskPacket({ workUnitId: workUnitG }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    await dispatchAttempt({
      adapter: new FakeEngineAdapter(
        buildFakeEngineScript({
          sessionId: sessionH,
          failure: { kind: "limitSignal", payload: RATE_LIMIT_ALLOWED_WARNING_96 },
        }),
      ),
      journal: store,
      packet: buildTaskPacket({ workUnitId: workUnitH }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });

    const statusG = await getParkStatus(store, workUnitG, 0);
    const statusH = await getParkStatus(store, workUnitH, 0);
    expect(statusG.sessionId).toBe(sessionG);
    expect(statusH.sessionId).toBe(sessionH);
    expect(statusG.sessionId).not.toBe(statusH.sessionId);
  });
});

describe("E2E: shadow-run alongside a live primary — isolation asserted", () => {
  it("the shadow attempt runs to completion in isolation while the primary dispatches and succeeds normally; primary journal/cache/artifacts are provably unmodified beyond the one marker entry", async () => {
    const workUnitId = "77777777-0000-4000-8000-000000000000";
    const primaryCache = new SchedulerCache<string>();
    const primaryArtifacts = new ArtifactStore();
    primaryCache.set({ contentHash: "h", toolchainFingerprint: "fp" }, "primary-cached-value");
    primaryArtifacts.put({
      workUnitId,
      attemptId: "primary-attempt",
      kind: "log",
      content: "primary log",
    });

    const primaryScript = buildFakeEngineScript({
      sessionId: "70000000-0000-4000-8000-000000000001",
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const primaryOutcome = await dispatchAttempt({
      adapter: new FakeEngineAdapter(primaryScript),
      journal: store,
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(primaryOutcome.kind).toBe("succeeded");

    const beforeShadow: unknown[] = [];
    for await (const entry of store.queryEntries()) beforeShadow.push(entry);

    const shadowScript = buildFakeEngineScript({
      sessionId: "70000000-0000-4000-8000-000000000002",
      structuredOutput: buildWorkerResult({
        outcome: "succeeded",
        summary: "shadow mirrored result",
      }),
    });
    const shadowResult = await runShadowAttempt({
      adapter: new FakeEngineAdapter(shadowScript),
      packet: buildTaskPacket({ workUnitId }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      journal: store,
      primaryWorkUnitId: workUnitId,
      // NOTE: `primaryCache`/`primaryArtifacts` are intentionally never
      // passed to runShadowAttempt at all — isolation is structural, not
      // merely a flag.
    });
    expect(shadowResult.workerResult?.summary).toBe("shadow mirrored result");

    const afterShadow: unknown[] = [];
    for await (const entry of store.queryEntries()) afterShadow.push(entry);
    // Exactly one new entry (the marker) — no mutation of the primary's own history.
    expect(afterShadow).toHaveLength(beforeShadow.length + 1);

    const primaryLatest = await getLatestAttempt(store, workUnitId);
    expect(primaryLatest?.status).toBe("succeeded");
    expect(primaryLatest?.sessionId).toBe("70000000-0000-4000-8000-000000000001");

    // Primary cache/artifacts are completely untouched by the shadow run.
    expect(primaryCache.get({ contentHash: "h", toolchainFingerprint: "fp" })).toBe(
      "primary-cached-value",
    );
    expect(primaryArtifacts.list(workUnitId, "primary-attempt")).toHaveLength(1);
    // The shadow's own artifacts are isolated in its own fresh store.
    expect(shadowResult.artifacts.recordCount).toBeGreaterThan(0);
  });
});

describe("E2E: delegation depth 1 / concurrency cap 4 asserted", () => {
  it("concurrency cap defaults to exactly 4", () => {
    expect(DEFAULT_CONCURRENCY_CAP).toBe(4);
  });

  it("every compiled profile this executor dispatches with unconditionally denies 'Agent' (delegation depth 1 — enforced upstream by 03's envelope compiler, asserted here)", () => {
    const envelope = buildAuthorizationEnvelope({ ownedPaths: ["packages/example/src/"] });
    const profile = compileEnvelope(envelope);
    expect(profile.permissions.deny).toContain("Agent");
    expect(profile.sdkOptions.disallowedTools).toContain("Agent");
  });
});
