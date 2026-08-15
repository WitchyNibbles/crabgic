import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import {
  HALTING_AUTONOMY,
  type AutonomySettings,
  type RunLifecycleState,
} from "@crabgic/contracts";
import { createRunsRegistry, type RunsRegistry } from "../registries/runs-registry.js";
import { transitionRun } from "../run-lifecycle/run-transition.js";
import { applyStopCondition } from "./autonomous-stop-conditions.js";

/**
 * The autonomy-aware halt path — owner ruling R3 (2026-08-15), roadmap/25 WI 10.
 *
 * `haltOnStopCondition` always halts, which is correct and is left untouched.
 * This wraps it: under an autonomy document the two conditions R3 granted take
 * their declared default and the run CONTINUES, with the decision journaled so
 * the owner can see afterwards what was decided on their behalf.
 *
 * The owner's pipeline requires that after the design gate "no human/user
 * feedback is needed". These tests are where that stops being a sentence.
 */

let journalDir: string;
let store: JournalStore;
let runs: RunsRegistry;

const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";

const AUTONOMOUS: AutonomySettings = {
  schemaVersion: 1,
  defaults: { irreducible_product_decision: "prefer-reversible", exhausted_repairs: "park" },
};

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-autonomous-stop-"));
  store = createJournalStore({ journalDir });
  runs = createRunsRegistry();
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

async function driveToRunning(runId: string): Promise<void> {
  for (const to of ["awaiting_approval", "ready", "running"] satisfies RunLifecycleState[]) {
    await transitionRun({ journal: store, runs, runId, changeSetId: CHANGE_SET_ID, to });
  }
}

const runIdFor = (n: number): string => `33333333-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("applyStopCondition — the two conditions R3 granted", () => {
  it("does NOT halt on irreducible_product_decision under an autonomy document", async () => {
    const runId = runIdFor(1);
    await driveToRunning(runId);
    const result = await applyStopCondition({
      journal: store,
      runs,
      runId,
      changeSetId: CHANGE_SET_ID,
      kind: "irreducible_product_decision",
      reason: "two defensible schemas",
      autonomy: AUTONOMOUS,
    });
    expect(result.halted).toBe(false);
    expect(result.disposition).toBe("prefer-reversible");
    // The run is still going. This is the whole point of the ruling.
    expect(runs.get(runId)?.runState).toBe("running");
  });

  it("journals the defaulted decision, so the owner can see it afterwards", async () => {
    // The owner no longer blocks on this, so the journal is the ONLY place it
    // can ever be seen. A default taken and not recorded is exactly the silent
    // choosing R3 was careful to forbid.
    const runId = runIdFor(2);
    await driveToRunning(runId);
    await applyStopCondition({
      journal: store,
      runs,
      runId,
      changeSetId: CHANGE_SET_ID,
      kind: "exhausted_repairs",
      reason: "three attempts spent on work-unit 7",
      autonomy: AUTONOMOUS,
    });
    const collected: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "adjudication_decision", runId })) {
      collected.push(entry);
    }
    const serialized = JSON.stringify(collected);
    expect(serialized).toMatch(/park/);
    // Both halves: what was decided, AND why the condition fired. "We
    // defaulted" without the trigger is unauditable.
    expect(serialized).toMatch(/three attempts spent on work-unit 7/);
    // And that it was declared in advance rather than chosen while the decision
    // was live -- the distinction R3 rests on.
    expect(serialized).toMatch(/declared before the run/i);
  });
});

describe("applyStopCondition — what still halts", () => {
  it("halts on expanded_authority even under the most permissive document", async () => {
    // Gap 18's safety argument, at runtime. The autonomy document cannot even
    // express a default for this condition; this is the other half of that
    // guarantee.
    const runId = runIdFor(3);
    await driveToRunning(runId);
    const result = await applyStopCondition({
      journal: store,
      runs,
      runId,
      changeSetId: CHANGE_SET_ID,
      kind: "expanded_authority",
      reason: "envelope not contained in the standing policy",
      autonomy: AUTONOMOUS,
    });
    expect(result.halted).toBe(true);
    expect(runs.get(runId)?.runState).toBe("blocked");
  });

  it("halts on a condition R3 never covered", async () => {
    // Defaulting one of the four by omission is how a scope ruling quietly
    // becomes a general permission.
    const runId = runIdFor(4);
    await driveToRunning(runId);
    const result = await applyStopCondition({
      journal: store,
      runs,
      runId,
      changeSetId: CHANGE_SET_ID,
      kind: "critical_security_issue",
      reason: "exposed credential in a fixture",
      autonomy: AUTONOMOUS,
    });
    expect(result.halted).toBe(true);
    expect(runs.get(runId)?.runState).toBe("blocked");
  });

  it("halts on everything when no autonomy document is configured", async () => {
    // A project that never opted in behaves exactly as it did before this work
    // item. Absence means halt, because the permissive direction is the
    // dangerous one.
    const runId = runIdFor(5);
    await driveToRunning(runId);
    const result = await applyStopCondition({
      journal: store,
      runs,
      runId,
      changeSetId: CHANGE_SET_ID,
      kind: "irreducible_product_decision",
      reason: "two defensible schemas",
      autonomy: HALTING_AUTONOMY,
    });
    expect(result.halted).toBe(true);
    expect(runs.get(runId)?.runState).toBe("blocked");
  });
});
