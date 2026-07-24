import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { IllegalTransitionError, type RunLifecycleState } from "@eo/contracts";
import { createRunsRegistry, type RunsRegistry } from "../registries/runs-registry.js";
import { transitionRun } from "../run-lifecycle/run-transition.js";
import { haltOnStopCondition, STOP_CONDITION_KINDS } from "./stop-conditions.js";

let journalDir: string;
let store: JournalStore;
let runs: RunsRegistry;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-stop-conditions-"));
  store = createJournalStore({ journalDir });
  runs = createRunsRegistry();
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";

async function driveToRunning(runId: string): Promise<void> {
  for (const to of ["awaiting_approval", "ready", "running"] satisfies RunLifecycleState[]) {
    await transitionRun({ journal: store, runs, runId, changeSetId: CHANGE_SET_ID, to });
  }
}

describe("haltOnStopCondition", () => {
  it.each(STOP_CONDITION_KINDS.map((kind, index) => [kind, index] as const))(
    "halts an in-flight run to blocked for stop condition %s, and no other transition",
    async (kind, index) => {
      const runId = `11111111-0000-4000-8000-${String(index).padStart(12, "0")}`;
      await driveToRunning(runId);

      const record = await haltOnStopCondition({
        journal: store,
        runs,
        runId,
        changeSetId: CHANGE_SET_ID,
        kind,
        reason: `seeded fixture for ${kind}`,
      });

      expect(record.runState).toBe("blocked");
      expect(runs.get(runId)?.runState).toBe("blocked");

      const decisions: unknown[] = [];
      for await (const entry of store.queryEntries({ type: "adjudication_decision", runId })) {
        decisions.push(entry);
      }
      expect(decisions).toHaveLength(1);
    },
  );

  it("throws IllegalTransitionError when the run is already terminal (blocked can't fire twice)", async () => {
    const runId = "33333333-3333-4333-8333-333333333333";
    await driveToRunning(runId);
    await haltOnStopCondition({
      journal: store,
      runs,
      runId,
      changeSetId: CHANGE_SET_ID,
      kind: "critical_security_issue",
      reason: "first halt",
    });

    await expect(
      haltOnStopCondition({
        journal: store,
        runs,
        runId,
        changeSetId: CHANGE_SET_ID,
        kind: "critical_security_issue",
        reason: "second halt attempt",
      }),
    ).rejects.toThrow(IllegalTransitionError);

    // LOW L7: the illegal-transition failure must leave no trace — no
    // adjudication_decision record for a halt that never actually happened
    // (only the ONE real halt above should be journaled).
    const decisions: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "adjudication_decision", runId })) {
      decisions.push(entry);
    }
    expect(decisions).toHaveLength(1);
  });

  it("exposes exactly 7 named stop conditions", () => {
    expect(STOP_CONDITION_KINDS).toHaveLength(7);
  });
});
