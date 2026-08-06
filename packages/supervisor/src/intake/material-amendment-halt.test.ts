import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { IllegalTransitionError, type RunLifecycleState } from "@crabgic/contracts";
import { createRunsRegistry, type RunsRegistry } from "../registries/runs-registry.js";
import { transitionRun } from "../run-lifecycle/run-transition.js";
import { haltRunOnMaterialAmendment } from "./material-amendment-halt.js";

let journalDir: string;
let store: JournalStore;
let runs: RunsRegistry;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-material-amendment-halt-"));
  store = createJournalStore({ journalDir });
  runs = createRunsRegistry();
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const REQUIREMENT_ID = "66666666-6666-4666-8666-666666666666";

// Copied verbatim from ./stop-conditions.test.ts:27-31 — the same walk to
// an IN-FLIGHT state, because that is the state a mid-run remote amendment
// is discovered in.
async function driveToRunning(runId: string): Promise<void> {
  for (const to of ["awaiting_approval", "ready", "running"] satisfies RunLifecycleState[]) {
    await transitionRun({ journal: store, runs, runId, changeSetId: CHANGE_SET_ID, to });
  }
}

async function decisionsFor(runId: string): Promise<readonly { rationale: string }[]> {
  const found: { rationale: string }[] = [];
  for await (const entry of store.queryEntries({ type: "adjudication_decision", runId })) {
    if (entry.type !== "adjudication_decision") continue;
    found.push({ rationale: entry.payload.rationale });
  }
  return found;
}

describe("haltRunOnMaterialAmendment — 21's signal wired to 11's stop condition", () => {
  it("a material signal halts an in-flight run: run -> blocked, one adjudication_decision naming material_amendment", async () => {
    const runId = "55555555-0000-4000-8000-000000000001";
    await driveToRunning(runId);

    const outcome = await haltRunOnMaterialAmendment(
      { requirementId: REQUIREMENT_ID, material: true, materialFields: ["description"] },
      { journal: store, runs, runId, changeSetId: CHANGE_SET_ID },
    );

    expect(outcome.halted).toBe(true);
    if (!outcome.halted) throw new Error("unreachable");
    expect(outcome.record.runState).toBe("blocked");
    // `blocked` asserted as the exact value of a closed 11-member enum
    // field, never as a substring — so 17's `MilestoneSyncOutcome.status`
    // "blocked", `JiraWorkflowStage` "blocked" and gate-verdict prose can
    // never satisfy it.
    expect(runs.get(runId)?.runState).toBe("blocked");

    const decisions = await decisionsFor(runId);
    expect(decisions).toHaveLength(1);
    // The criterion names the KIND, so the rationale's content is asserted,
    // not merely that some decision exists — a bare "a decision was
    // journaled" bearer would survive swapping material_amendment for any
    // other of the 7 kinds.
    expect(decisions[0]?.rationale).toContain('stop condition "material_amendment"');
    expect(decisions[0]?.rationale).toContain(REQUIREMENT_ID);
    expect(decisions[0]?.rationale).toContain("description");
  });

  it("does-not-halt control: a non-material signal leaves the run running, journals nothing, and the run still reaches final_verifying", async () => {
    // Without this control, an unconditional
    // `() => haltOnStopCondition(...)` would pass the positive test above
    // identically. The strongest form of "the rationale is absent" is that
    // the decision list for this run has length 0.
    const runId = "55555555-0000-4000-8000-000000000002";
    await driveToRunning(runId);

    const outcome = await haltRunOnMaterialAmendment(
      { requirementId: REQUIREMENT_ID, material: false, materialFields: [] },
      { journal: store, runs, runId, changeSetId: CHANGE_SET_ID },
    );

    // Exact shape: no `record`, no reason string — disjoint from the
    // halted outcome, so no matched string of the positive case appears here.
    expect(outcome).toEqual({ halted: false });
    expect(runs.get(runId)?.runState).toBe("running");
    expect(await decisionsFor(runId)).toHaveLength(0);

    // Unimpeded progress: the halt is not unconditional, and this run does
    // reach `final_verifying` — the state the criterion says a halted run
    // must never get to.
    for (const to of [
      "verifying",
      "integrating",
      "final_verifying",
    ] satisfies RunLifecycleState[]) {
      await transitionRun({ journal: store, runs, runId, changeSetId: CHANGE_SET_ID, to });
    }
    expect(runs.get(runId)?.runState).toBe("final_verifying");
  });

  it("an already-halted run cannot be halted again — haltOnStopCondition's no-resurrect rule propagates", async () => {
    const runId = "55555555-0000-4000-8000-000000000003";
    await driveToRunning(runId);
    const signal = {
      requirementId: REQUIREMENT_ID,
      material: true,
      materialFields: ["summary"],
    } as const;

    await haltRunOnMaterialAmendment(signal, {
      journal: store,
      runs,
      runId,
      changeSetId: CHANGE_SET_ID,
    });
    expect(runs.get(runId)?.runState).toBe("blocked");

    await expect(
      haltRunOnMaterialAmendment(signal, {
        journal: store,
        runs,
        runId,
        changeSetId: CHANGE_SET_ID,
      }),
    ).rejects.toThrow(IllegalTransitionError);

    // LOW L7 ordering survives the wrapper: the refused second halt leaves
    // no stray decision record behind.
    expect(await decisionsFor(runId)).toHaveLength(1);
  });
});
