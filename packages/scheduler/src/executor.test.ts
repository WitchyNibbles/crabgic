import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, getLatestAttempt, type JournalStore } from "@crabgic/journal";
import {
  buildFakeEngineScript,
  buildTaskPacket,
  buildWorkerResult,
  FakeEngineAdapter,
} from "@crabgic/testkit";
import {
  RATE_LIMIT_ALLOWED_FIVE_HOUR,
  RATE_LIMIT_ALLOWED_WARNING_96,
  RATE_LIMIT_REJECTED,
} from "@crabgic/testkit";
import {
  allowAllAdjudicate,
  buildMinimalCompiledProfile,
} from "./test-support/minimal-compiled-profile.js";
import { dispatchAttempt, resumeAttempt } from "./executor.js";
import {
  GlobalPauseActiveError,
  PacketBudgetExceededError,
  RepairEvidenceRequiredError,
} from "./errors.js";
import { DEFAULT_PACKET_FIELD_BUDGETS } from "./budgets.js";
import { parkWorkUnit } from "./parking.js";
import { buildRequirement } from "@crabgic/testkit";
import type { Requirement } from "@crabgic/contracts";

const WORK_UNIT_ID = "11111111-1111-4111-8111-111111111111";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-scheduler-executor-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("dispatchAttempt", () => {
  it("journals session_assignment then dispatched, and returns 'succeeded' for a clean success script", async () => {
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const adapter = new FakeEngineAdapter(script);
    const packet = buildTaskPacket({ workUnitId: WORK_UNIT_ID });

    const outcome = await dispatchAttempt({
      adapter,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      journal: store,
      packet,
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });

    expect(outcome.kind).toBe("succeeded");

    const sessionEntries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "session_assignment" }))
      sessionEntries.push(entry);
    expect(sessionEntries).toHaveLength(1);

    const latest = await getLatestAttempt(store, WORK_UNIT_ID);
    expect(latest?.status).toBe("succeeded");
  });

  it("threads a caller-supplied runId onto the session_assignment entry", async () => {
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const adapter = new FakeEngineAdapter(script);
    const runId = "88888888-8888-4888-8888-888888888888";

    await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      runId,
    });

    const sessionEntries: { runId?: string }[] = [];
    for await (const entry of store.queryEntries({ type: "session_assignment" })) {
      sessionEntries.push(entry as { runId?: string });
    }
    expect(sessionEntries[0]?.runId).toBe(runId);
  });

  it("CRASH-RECOVERY FIX: threads the caller-supplied runId onto the succeeded work_unit_transition entry too (not just session_assignment) — this is what lets @crabgic/supervisor's recoverRun see a real dispatch's terminal status after a restart", async () => {
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const adapter = new FakeEngineAdapter(script);
    const runId = "99999999-9999-4999-8999-999999999999";

    const outcome = await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      runId,
    });
    expect(outcome.kind).toBe("succeeded");

    const transitionEntries: { runId?: string; type: string }[] = [];
    for await (const entry of store.queryEntries({
      type: "work_unit_transition",
      workUnitId: WORK_UNIT_ID,
    })) {
      transitionEntries.push(entry as { runId?: string; type: string });
    }
    // Both the "dispatched" and "succeeded" transitions must carry runId.
    expect(transitionEntries.length).toBeGreaterThanOrEqual(2);
    for (const entry of transitionEntries) {
      expect(entry.runId).toBe(runId);
    }

    // The SAME runId-scoped query recoverRun's recover(runId) itself uses
    // must also see these entries — proving they are not merely present,
    // but genuinely reachable by runId-filtered replay.
    const scoped: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "work_unit_transition", runId })) {
      scoped.push(entry);
    }
    expect(scoped.length).toBeGreaterThanOrEqual(2);
  });

  it("returns 'failed' with evidenceKind 'workerResultFailure' for a self-reported failure", async () => {
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "failed", diagnostics: ["it broke"] }),
    });
    const adapter = new FakeEngineAdapter(script);
    const outcome = await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome).toMatchObject({ kind: "failed", evidenceKind: "workerResultFailure" });
    if (outcome.kind === "failed") expect(outcome.diagnostics).toEqual(["it broke"]);
  });

  it("returns 'crashed' with evidenceKind 'crash' for an abrupt stream end", async () => {
    const script = buildFakeEngineScript({ failure: { kind: "crash", atStepIndex: 0 } });
    const adapter = new FakeEngineAdapter(script);
    const outcome = await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome).toEqual({
      kind: "crashed",
      sessionId: expect.any(String) as string,
      evidenceKind: "crash",
    });
    const latest = await getLatestAttempt(store, WORK_UNIT_ID);
    expect(latest?.status).toBe("failed");
  });

  it("returns 'failed' with evidenceKind 'schemaViolation' for a schema-violating result", async () => {
    const script = buildFakeEngineScript({ failure: { kind: "schemaViolation" } });
    const adapter = new FakeEngineAdapter(script);
    const outcome = await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome).toMatchObject({ kind: "failed", evidenceKind: "schemaViolation" });
  });

  it("returns 'cancelled' for a self-reported cancellation", async () => {
    const script = buildFakeEngineScript({
      structuredOutput: buildWorkerResult({ outcome: "cancelled" }),
    });
    const adapter = new FakeEngineAdapter(script);
    const outcome = await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome.kind).toBe("cancelled");
  });

  /**
   * MEASURED 2026-08-16, on the live run 08f1f1dd, and the reason no crabgic
   * work unit had ever completed.
   *
   * The SDK emits `rate_limit_event` as ROUTINE USAGE TELEMETRY. Every one of
   * the sixteen samples `docs/engine-baseline.md` §8 recorded carries `status`
   * `allowed` or `allowed_warning`, and the baseline's own directive to phase
   * 06 is to watch for "a `status` transition to `'rejected'`". The executor
   * instead parked on ANY `limitSignal`. So a worker parked seconds after
   * dispatch, on a message saying it was ALLOWED to proceed, and waited for the
   * next five-hour window — where it parked again. Four dispatches over eleven
   * hours produced nine seconds of work and no code.
   *
   * The bug survived 7489 green tests because the tests encoded it: this very
   * case asserted that an `allowed_warning` payload MUST park. The fixtures
   * were faithful recordings; the assertion built on them was not.
   *
   * `allowed_warning` deliberately does NOT park either. Baseline §8 offers it
   * as an early-warning the scheduler *can* park on before hard rejection —
   * permission, not instruction — and pre-emptive parking trades a possible
   * future block for a certain present stall, which is precisely what was just
   * measured. If it is ever wanted it belongs behind an explicit utilization
   * threshold, not in the default path.
   */
  /**
   * MEASURED on run 97fb3b10 (2026-08-16), the first run that produced code.
   * Its worker returned `{outcome, summary}` — `WorkerResult` also requires
   * `schemaVersion`/`id`/`workUnitId` — so the attempt failed as a
   * `schemaViolation`, and the journal recorded only:
   *
   *     {"status": "failed", "previousStatus": "dispatched", "sessionId": "…"}
   *
   * No reason. The diagnostics existed and were returned in memory, then
   * discarded. Recovering the cause meant reading the executor's branches and
   * the worker's raw transcript.
   *
   * The seal-refusal branch TWELVE LINES BELOW already journals first, and its
   * own comment states the rule this branch broke: "a crash between the two
   * must leave the REASON behind, not a bare `failed` nothing accounts for."
   * The lesson was learned in one branch and not applied to its sibling.
   */
  it("journals WHY a schema violation failed, before the failed transition", async () => {
    const script = buildFakeEngineScript({ failure: { kind: "schemaViolation" } });
    const adapter = new FakeEngineAdapter(script);
    const outcome = await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome.kind).toBe("failed");

    const entries: { type: string; payload: Record<string, unknown> }[] = [];
    for await (const e of store.queryEntries()) {
      entries.push({ type: e.type, payload: e.payload as Record<string, unknown> });
    }
    const refusal = entries.find(
      (e) => e.type === "adjudication_decision" && e.payload.decision === "worker_result_rejected",
    );
    expect(refusal, "a bare `failed` with no journaled cause is the defect").toBeDefined();
    expect(String(refusal?.payload.rationale)).toMatch(/schema/i);

    // Ordered: the REASON must survive a crash between the two writes, so it is
    // written first — the same rule the seal-refusal branch already follows.
    const reasonIdx = entries.findIndex(
      (e) => e.type === "adjudication_decision" && e.payload.decision === "worker_result_rejected",
    );
    const failedIdx = entries.findIndex(
      (e) => e.type === "work_unit_transition" && e.payload.status === "failed",
    );
    expect(reasonIdx).toBeLessThan(failedIdx);
  });

  it("does NOT park on `allowed` telemetry — it is not an exhaustion", async () => {
    const script = buildFakeEngineScript({
      failure: { kind: "limitSignal", payload: RATE_LIMIT_ALLOWED_FIVE_HOUR },
    });
    const adapter = new FakeEngineAdapter(script);
    const outcome = await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome.kind).not.toBe("parked");
    const latest = await getLatestAttempt(store, WORK_UNIT_ID);
    expect(latest?.status).not.toBe("parked:rate_limit");
  });

  it("does NOT park on `allowed_warning` either — a warning is not a refusal", async () => {
    const script = buildFakeEngineScript({
      failure: { kind: "limitSignal", payload: RATE_LIMIT_ALLOWED_WARNING_96 },
    });
    const adapter = new FakeEngineAdapter(script);
    const outcome = await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome.kind).not.toBe("parked");
  });

  it("DOES park on `rejected`, account-wide, retaining the sessionId", async () => {
    // The positive control. Without it the two refusals above would be
    // satisfied by an executor that never parks at all.
    const script = buildFakeEngineScript({
      failure: {
        kind: "limitSignal",
        payload: { ...RATE_LIMIT_ALLOWED_FIVE_HOUR, status: "rejected" },
      },
    });
    const adapter = new FakeEngineAdapter(script);
    const outcome = await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(outcome).toMatchObject({
      kind: "parked",
      resetsAt: RATE_LIMIT_ALLOWED_FIVE_HOUR.resetsAt,
      accountWide: true,
    });
    const latest = await getLatestAttempt(store, WORK_UNIT_ID);
    expect(latest?.status).toBe("parked:rate_limit");
    if (outcome.kind === "parked") expect(latest?.sessionId).toBe(outcome.sessionId);
  });

  it("throws PacketBudgetExceededError before ever calling adapter.spawn for an over-budget packet", async () => {
    const script = buildFakeEngineScript();
    let spawnCalled = false;
    const adapter = new FakeEngineAdapter(script);
    const originalSpawn = adapter.spawn.bind(adapter);
    adapter.spawn = (...args) => {
      spawnCalled = true;
      return originalSpawn(...args);
    };

    const oversizedPacket = buildTaskPacket({
      workUnitId: WORK_UNIT_ID,
      objective: "x".repeat(DEFAULT_PACKET_FIELD_BUDGETS.objective + 1),
    });

    await expect(
      dispatchAttempt({
        adapter,
        journal: store,
        criteriaSeal: { requirements: [], approvalSeal: undefined },
        packet: oversizedPacket,
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: "none",
      }),
    ).rejects.toThrow(PacketBudgetExceededError);
    expect(spawnCalled).toBe(false);
  });

  it("MINOR-3 fix: an active account-wide rate-limit pause BLOCKS dispatchAttempt with GlobalPauseActiveError, before ever calling adapter.spawn", async () => {
    // A DIFFERENT work unit's account-wide limitSignal establishes the
    // global pause — proving the gate is genuinely account-WIDE, not
    // scoped to the work unit under test.
    await parkWorkUnit({
      journal: store,
      workUnitId: "33333333-0000-4000-8000-000000033333",
      sessionId: "12121212-0000-4000-8000-000000000000",
      resetsAt: 5000,
      accountWide: true,
    });

    let spawnCalled = false;
    const adapter = new FakeEngineAdapter(buildFakeEngineScript());
    const originalSpawn = adapter.spawn.bind(adapter);
    adapter.spawn = (...args) => {
      spawnCalled = true;
      return originalSpawn(...args);
    };

    await expect(
      dispatchAttempt({
        adapter,
        journal: store,
        criteriaSeal: { requirements: [], approvalSeal: undefined },
        packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: "none",
        nowSeconds: () => 4000, // before the global reset
      }),
    ).rejects.toThrow(GlobalPauseActiveError);
    expect(spawnCalled).toBe(false);
  });

  it("MINOR-3 fix: dispatchAttempt proceeds normally once the simulated clock passes the global reset", async () => {
    await parkWorkUnit({
      journal: store,
      workUnitId: "33333333-0000-4000-8000-000000033333",
      sessionId: "12121212-0000-4000-8000-000000000000",
      resetsAt: 5000,
      accountWide: true,
    });

    const outcome = await dispatchAttempt({
      adapter: new FakeEngineAdapter(
        buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "succeeded" }) }),
      ),
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      nowSeconds: () => 6000, // after the global reset
    });
    expect(outcome.kind).toBe("succeeded");
  });
});

// MAJOR-1 (adversarial-validation round, since fixed): `resumeAttempt` used
// to accept no `trigger` at all and NEVER called `assertRepairAllowed`,
// so a crash-recovery repair issued via `resumeAttempt` (the roadmap's own
// "same recovery machinery, different trigger" path) could bypass the
// 1-initial-plus-2-repairs cap entirely — reproduced directly against the
// pre-fix code (a bare `resumeAttempt({...no trigger...})` call proceeded
// to `"succeeded"` with zero `RepairEvidenceRequiredError`, even with the
// cap already exhausted). Fixed by making `trigger` a REQUIRED
// discriminant (`ResumeTrigger`, `./executor.ts`): `"crashRepair"` now
// routes through the IDENTICAL gate `dispatchAttempt` uses;
// `"parkResume"` skips it (an external throttle is never a repair). The
// two regression tests below — in the `resumeAttempt` suite — are the
// GREEN proof this bug is closed.

describe("resumeAttempt", () => {
  it("resumes the SAME session id and reaches a terminal outcome via the onResume continuation script", async () => {
    const parkScript = buildFakeEngineScript({
      sessionId: "99999999-9999-4999-8999-999999999999",
      failure: { kind: "limitSignal", payload: RATE_LIMIT_REJECTED },
      onResume: buildFakeEngineScript({
        sessionId: "99999999-9999-4999-8999-999999999999",
        structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
      }),
    });
    const adapter = new FakeEngineAdapter(parkScript);

    const parkOutcome = await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    expect(parkOutcome.kind).toBe("parked");

    const sessionRef = {
      sessionId: "99999999-9999-4999-8999-999999999999",
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    };
    const resumeOutcome = await resumeAttempt({
      adapter,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      journal: store,
      sessionRef,
      workUnitId: WORK_UNIT_ID,
      adjudicate: allowAllAdjudicate,
      trigger: { kind: "parkResume" },
    });

    expect(resumeOutcome).toMatchObject({
      kind: "succeeded",
      sessionId: "99999999-9999-4999-8999-999999999999",
    });
    const latest = await getLatestAttempt(store, WORK_UNIT_ID);
    expect(latest?.status).toBe("succeeded");
    expect(latest?.sessionId).toBe("99999999-9999-4999-8999-999999999999");
  });

  it("MAJOR-1 fix: resumeAttempt with trigger 'crashRepair' IS gated identically to dispatchAttempt — refused with a typed error once the cap is exhausted", async () => {
    const workUnitId = "dddddddd-0000-4000-8000-00000000000d";
    // Exhaust the cap: 1 initial + 2 evidence-driven repairs, all via
    // dispatchAttempt (fresh spawns) — 3 real dispatches recorded.
    for (let i = 0; i < 3; i++) {
      const script = buildFakeEngineScript({
        structuredOutput: buildWorkerResult({ outcome: "failed", diagnostics: [`f${String(i)}`] }),
      });
      await dispatchAttempt({
        adapter: new FakeEngineAdapter(script),
        journal: store,
        criteriaSeal: { requirements: [], approvalSeal: undefined },
        packet: buildTaskPacket({ workUnitId }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: i === 0 ? "none" : "workerResultFailure",
      });
    }

    // A 4th attempt via resumeAttempt's crashRepair trigger is refused —
    // the SAME cap dispatchAttempt itself is subject to, closing the
    // MAJOR-1 bypass. adapter.resume must never even be called.
    const sessionId = "eeeeeeee-0000-4000-8000-00000000000e";
    const adapter = new FakeEngineAdapter(buildFakeEngineScript({ sessionId }));
    let resumeCalled = false;
    const originalResume = adapter.resume.bind(adapter);
    adapter.resume = (...args) => {
      resumeCalled = true;
      return originalResume(...args);
    };
    const sessionRef = {
      sessionId,
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    };

    await expect(
      resumeAttempt({
        adapter,
        criteriaSeal: { requirements: [], approvalSeal: undefined },
        journal: store,
        sessionRef,
        workUnitId,
        adjudicate: allowAllAdjudicate,
        trigger: { kind: "crashRepair", evidenceKind: "workerResultFailure" },
      }),
    ).rejects.toThrow(RepairEvidenceRequiredError);
    expect(resumeCalled).toBe(false);
  });

  it("MAJOR-1 fix: resumeAttempt with trigger 'parkResume' never requires evidence and never consumes a repair slot, even after the cap would otherwise be exhausted", async () => {
    const workUnitId = "ffffffff-0000-4000-8000-00000000000f";
    // Exhaust the REAL repair cap (3 dispatches: 1 initial + 2 repairs).
    for (let i = 0; i < 3; i++) {
      const script = buildFakeEngineScript({
        structuredOutput: buildWorkerResult({ outcome: "failed", diagnostics: [`f${String(i)}`] }),
      });
      await dispatchAttempt({
        adapter: new FakeEngineAdapter(script),
        journal: store,
        criteriaSeal: { requirements: [], approvalSeal: undefined },
        packet: buildTaskPacket({ workUnitId }),
        profile: buildMinimalCompiledProfile(),
        adjudicate: allowAllAdjudicate,
        evidenceKind: i === 0 ? "none" : "workerResultFailure",
      });
    }

    // Now the unit parks (simulated directly) and is resumed via
    // 'parkResume' — this must proceed with NO evidence and NO refusal,
    // even though the repair cap is already fully exhausted, because a
    // park-resume was never a repair in the first place.
    const sessionId = "10101010-0000-4000-8000-000000000000";
    const resumeSuccessScript = buildFakeEngineScript({
      sessionId,
      structuredOutput: buildWorkerResult({ outcome: "succeeded" }),
    });
    const registeringScript = buildFakeEngineScript({
      sessionId,
      failure: { kind: "limitSignal", payload: RATE_LIMIT_REJECTED },
      onResume: resumeSuccessScript,
    });
    const adapter = new FakeEngineAdapter(registeringScript);
    // Register the session (and its onResume continuation) with the fake
    // adapter via a throwaway spawn.
    await dispatchAttempt({
      adapter,
      journal: store,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      packet: buildTaskPacket({ workUnitId: "20202020-0000-4000-8000-000000000000" }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
    });
    const sessionRef = {
      sessionId,
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    };

    const resumeOutcome = await resumeAttempt({
      adapter,
      criteriaSeal: { requirements: [], approvalSeal: undefined },
      journal: store,
      sessionRef,
      workUnitId,
      adjudicate: allowAllAdjudicate,
      trigger: { kind: "parkResume" },
    });
    expect(resumeOutcome.kind).toBe("succeeded");
  });

  it("MINOR-3 fix: an active account-wide rate-limit pause BLOCKS resumeAttempt (both trigger kinds) with GlobalPauseActiveError, before ever calling adapter.resume", async () => {
    await parkWorkUnit({
      journal: store,
      workUnitId: "33333333-0000-4000-8000-000000033333",
      sessionId: "13131313-0000-4000-8000-000000000000",
      resetsAt: 5000,
      accountWide: true,
    });

    const sessionId = "14141414-0000-4000-8000-000000000000";
    const adapter = new FakeEngineAdapter(buildFakeEngineScript({ sessionId }));
    let resumeCalled = false;
    const originalResume = adapter.resume.bind(adapter);
    adapter.resume = (...args) => {
      resumeCalled = true;
      return originalResume(...args);
    };
    const sessionRef = {
      sessionId,
      projectDirectory: "/fake/project",
      worktreePath: "/fake/project/worktree",
      configDir: "/fake/project/.claude-config",
    };

    await expect(
      resumeAttempt({
        adapter,
        criteriaSeal: { requirements: [], approvalSeal: undefined },
        journal: store,
        sessionRef,
        workUnitId: WORK_UNIT_ID,
        adjudicate: allowAllAdjudicate,
        trigger: { kind: "parkResume" },
        nowSeconds: () => 4000,
      }),
    ).rejects.toThrow(GlobalPauseActiveError);
    expect(resumeCalled).toBe(false);
  });
});

/**
 * roadmap/24 WI5 — THE HEADLINE. Everything else in the phase records the
 * bar; this is what makes it mean something. A worker that reports success
 * after rewriting the criteria it was judged against must not have that
 * success accepted.
 *
 * The check runs at the ONE funnel where completion is accepted, before
 * `recordAttempt(..., "succeeded")`, and the seal context is a REQUIRED
 * option so a caller cannot reach that funnel without saying what bar
 * applies — the donor's first seal was reachable only through an optional
 * parameter, and its daemon path silently skipped it.
 */
describe("dispatchAttempt — acceptance-criteria seal enforcement", () => {
  const REQ_ID = "aaaaaaaa-1111-4111-8111-111111111111";

  function sealedRequirement(criteria: string[] = ["The login form submits"]): Requirement {
    return buildRequirement({ id: REQ_ID, acceptanceCriteria: criteria });
  }

  function succeedingAdapter(): FakeEngineAdapter {
    return new FakeEngineAdapter(
      buildFakeEngineScript({ structuredOutput: buildWorkerResult({ outcome: "succeeded" }) }),
    );
  }

  /**
   * Every seal-refusal adjudication this journal recorded — roadmap/24's
   * "the typed reason ... is journaled" clause. Read back out of the real
   * file-backed store, not off the in-memory outcome, because an outcome a
   * caller drops on the floor is not evidence.
   */
  async function sealRefusals(filter: { readonly runId?: string } = {}): Promise<
    readonly {
      readonly rationale: string;
      readonly subjectId?: string;
      readonly workUnitId?: string;
      readonly runId?: string;
    }[]
  > {
    const found: {
      rationale: string;
      subjectId?: string;
      workUnitId?: string;
      runId?: string;
    }[] = [];
    for await (const entry of store.queryEntries({
      type: "adjudication_decision",
      ...filter,
    })) {
      if (entry.type !== "adjudication_decision") continue;
      if (entry.payload.decision !== "criteria_seal_refused") continue;
      found.push({
        rationale: entry.payload.rationale,
        ...(entry.payload.subjectId !== undefined ? { subjectId: entry.payload.subjectId } : {}),
        ...(entry.workUnitId !== undefined ? { workUnitId: entry.workUnitId } : {}),
        ...(entry.runId !== undefined ? { runId: entry.runId } : {}),
      });
    }
    return found;
  }

  it("accepts a success whose criteria still match what was approved", async () => {
    const requirement = sealedRequirement();
    const outcome = await dispatchAttempt({
      adapter: succeedingAdapter(),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      criteriaSeal: {
        requirements: [requirement],
        approvalSeal: {
          changeSetId: "22222222-2222-4222-8222-222222222222",
          criteriaHashes: { [REQ_ID]: requirement.criteriaHash },
        },
      },
    });

    expect(outcome.kind).toBe("succeeded");
    expect((await getLatestAttempt(store, WORK_UNIT_ID))?.status).toBe("succeeded");
    // A clean pass journals no refusal — the entry exists only when the bar was broken.
    expect(await sealRefusals()).toHaveLength(0);
  });

  it("REFUSES a success whose criteria were rewritten after approval — recorded failed, never succeeded", async () => {
    const approved = sealedRequirement(["The login form submits"]);
    // The worker's own, widened bar — self-consistent, hash recomputed.
    const widened = sealedRequirement(["Anything at all is acceptable"]);

    const outcome = await dispatchAttempt({
      adapter: succeedingAdapter(),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      criteriaSeal: {
        requirements: [widened],
        approvalSeal: {
          changeSetId: "22222222-2222-4222-8222-222222222222",
          criteriaHashes: { [REQ_ID]: approved.criteriaHash },
        },
      },
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.diagnostics.join(" ")).toContain("approval_seal_mismatch");

    // The journal must not carry a `succeeded` for a unit that rewrote its bar.
    const latest = await getLatestAttempt(store, WORK_UNIT_ID);
    expect(latest?.status).toBe("failed");

    // roadmap/24 exit criterion: the TYPED REASON is journaled, not merely
    // returned. A `failed` with no recorded reason is indistinguishable from
    // an ordinary flaky worker, which is exactly what the tamper fixture is
    // supposed to make impossible to confuse.
    const refusals = await sealRefusals();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.rationale).toContain("approval_seal_mismatch");
    expect(refusals[0]!.rationale).toContain(REQ_ID);
    expect(refusals[0]!.subjectId).toBe(WORK_UNIT_ID);
    expect(refusals[0]!.workUnitId).toBe(WORK_UNIT_ID);
    // Security bullet: ids and hashes only. The criteria TEXT — the very
    // thing the tamperer wrote — never enters the journal.
    expect(refusals[0]!.rationale).not.toContain("Anything at all is acceptable");
    expect(refusals[0]!.rationale).not.toContain("The login form submits");
  });

  it("REFUSES a success when the change set was never sealed — fail-closed, not fail-open", async () => {
    const outcome = await dispatchAttempt({
      adapter: succeedingAdapter(),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      criteriaSeal: { requirements: [sealedRequirement()], approvalSeal: undefined },
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.diagnostics.join(" ")).toContain("no_approval_seal");
    expect((await getLatestAttempt(store, WORK_UNIT_ID))?.status).toBe("failed");

    // Same clause, the fail-closed half: "never approved" is journaled with
    // its own typed reason, distinguishable from "approved and then edited".
    const refusals = await sealRefusals();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.rationale).toContain("no_approval_seal");
    expect(refusals[0]!.rationale).toContain(REQ_ID);
    expect(refusals[0]!.subjectId).toBe(WORK_UNIT_ID);
  });

  /**
   * The refusal entry carries `runId` for exactly the reason `recordAttempt`
   * was fixed to: `@crabgic/journal`'s `recover(runId)` replays only entries
   * matching an EXACT `runId` filter, so an entry written without one is
   * invisible to the run that produced it. A tamper refusal nobody can find
   * when reconstructing the run is not much better than one never written.
   */
  it("scopes the journaled refusal to the run, so a runId-filtered replay can still find it", async () => {
    const runId = "88888888-8888-4888-8888-888888888888";
    const approved = sealedRequirement(["The login form submits"]);
    const widened = sealedRequirement(["Anything at all is acceptable"]);

    const outcome = await dispatchAttempt({
      adapter: succeedingAdapter(),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      runId,
      criteriaSeal: {
        requirements: [widened],
        approvalSeal: {
          changeSetId: "22222222-2222-4222-8222-222222222222",
          criteriaHashes: { [REQ_ID]: approved.criteriaHash },
        },
      },
    });

    expect(outcome.kind).toBe("failed");
    const scoped = await sealRefusals({ runId });
    expect(scoped).toHaveLength(1);
    expect(scoped[0]!.runId).toBe(runId);
    expect(scoped[0]!.rationale).toContain("approval_seal_mismatch");
  });

  it("a unit with no requirements of its own is accepted — the seal constrains, it does not invent work", async () => {
    const outcome = await dispatchAttempt({
      adapter: succeedingAdapter(),
      journal: store,
      packet: buildTaskPacket({ workUnitId: WORK_UNIT_ID }),
      profile: buildMinimalCompiledProfile(),
      adjudicate: allowAllAdjudicate,
      evidenceKind: "none",
      criteriaSeal: { requirements: [], approvalSeal: undefined },
    });

    expect(outcome.kind).toBe("succeeded");
  });
});
