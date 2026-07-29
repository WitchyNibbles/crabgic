/**
 * `createRun` — the join nothing in the shipped system performed.
 *
 * AUDIT FINDING (2026-07-28) this exists to close: `transitionRun` was
 * reachable from exactly two places, `run.cancel` (→ `cancelled`) and
 * `haltOnStopCondition` (→ `blocked`), and **both require a run that already
 * exists**. Nothing anywhere created one. So an approved `ChangeSet` could
 * reach `ready` and then had no execution path at all — `run.dispatch`
 * answered "unknown run" for every id, and `status` printed `no runs` after
 * a complete intake and approval. Verified against the built binary before
 * this module was written.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { IllegalTransitionError, RUN_LIFECYCLE_STATES, type ChangeSet } from "@crabgic/contracts";
import { createRunsRegistry, type RunsRegistry } from "../registries/runs-registry.js";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import type { Registry } from "../registries/registry.js";
import { createRun, findLiveRunForChangeSet, NOT_READY_REASON } from "./create-run.js";

const CHANGE_SET_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

let journalDir: string;
let journal: JournalStore;
let runs: RunsRegistry;
let changeSets: Registry<ChangeSet>;

function changeSet(state: ChangeSet["state"]): ChangeSet {
  return {
    schemaVersion: 1,
    id: CHANGE_SET_ID,
    state,
    intentContractId: "33333333-3333-4333-8333-333333333333",
    authorizationEnvelopeId: "44444444-4444-4444-8444-444444444444",
    capabilityManifestId: "55555555-5555-4555-8555-555555555555",
    provisionalPerformanceContractId: "66666666-6666-4666-8666-666666666666",
    integrationOrder: [],
    rollbackStrategy: "Revert the integration commit.",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-create-run-"));
  journal = createJournalStore({ journalDir });
  runs = createRunsRegistry();
  changeSets = createChangeSetsRegistry();
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("createRun", () => {
  it("puts a ready ChangeSet's run into `running`", async () => {
    changeSets.put(changeSet("ready"));

    const record = await createRun({
      journal,
      runs,
      changeSets,
      changeSetId: CHANGE_SET_ID,
      runId: RUN_ID,
    });

    expect(record.runId).toBe(RUN_ID);
    expect(record.changeSetId).toBe(CHANGE_SET_ID);
    expect(record.runState).toBe("running");
    expect(runs.get(RUN_ID)?.runState).toBe("running");
  });

  /**
   * `draft → running` is not an edge in 02's table, and this module
   * deliberately does not add one: the enum and its transitions are pinned
   * by interface-ledger Gap 4, so a run walks the vestigial approval prefix
   * rather than the table being widened for convenience. Under Gap 18 there
   * is no per-run approval left to wait in `awaiting_approval` for, which is
   * exactly why the walk is instantaneous rather than removed.
   */
  it("walks the pinned lifecycle rather than short-cutting to `running`", async () => {
    changeSets.put(changeSet("ready"));

    await createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID });

    const transitions: { from: string; to: string }[] = [];
    for await (const entry of journal.queryEntries({ runId: RUN_ID })) {
      if (entry.type === "run_transition") {
        transitions.push(entry.payload as { from: string; to: string });
      }
    }
    expect(transitions).toEqual([
      { from: "draft", to: "awaiting_approval" },
      { from: "awaiting_approval", to: "ready" },
      { from: "ready", to: "running" },
    ]);
  });

  it("refuses a ChangeSet that has not been approved to `ready`", async () => {
    changeSets.put(changeSet("awaiting_approval"));

    await expect(
      createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID }),
    ).rejects.toThrow(NOT_READY_REASON(CHANGE_SET_ID, "awaiting_approval"));
  });

  it("journals nothing at all when it refuses", async () => {
    changeSets.put(changeSet("draft"));

    await expect(
      createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID }),
    ).rejects.toThrow();

    const entries = [];
    for await (const entry of journal.queryEntries()) entries.push(entry);
    expect(entries).toHaveLength(0);
    expect(runs.get(RUN_ID)).toBeUndefined();
  });

  /**
   * REGRESSION GUARD. The `ready` check is deny-by-default and must stay
   * that way. Rewriting it as a list of disallowed states — "not draft and
   * not awaiting_approval" — passes the single-state test above while
   * admitting `cancelled`, `blocked`, `failed` and `published_local`: it
   * would dispatch a change set the owner had explicitly stopped.
   * `ChangeSet.state` is `RunLifecycleStateSchema`, so this enumerates every
   * member of that union rather than a sample, and a member added later
   * fails here until it is deliberately considered.
   */
  it.each(RUN_LIFECYCLE_STATES.filter((state) => state !== "ready"))(
    "refuses to dispatch a ChangeSet in state %s",
    async (state) => {
      changeSets.put(changeSet(state));

      await expect(
        createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID }),
      ).rejects.toThrow(NOT_READY_REASON(CHANGE_SET_ID, state));
    },
  );

  it("refuses an unknown ChangeSet", async () => {
    await expect(
      createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID }),
    ).rejects.toThrow(/unknown change set/i);
  });

  /**
   * The registry is keyed by `runId`, so a second `createRun` for the same
   * ChangeSet would happily mint a second, competing run over the same work
   * units. Callers are required to check first; this asserts the check they
   * must use actually distinguishes the cases.
   */
  it("re-running the same id is refused by the transition table, not silently duplicated", async () => {
    changeSets.put(changeSet("ready"));
    await createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID });

    await expect(
      createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
  });
});

describe("findLiveRunForChangeSet", () => {
  it("finds a run still in flight for the change set", async () => {
    changeSets.put(changeSet("ready"));
    await createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID });

    expect(findLiveRunForChangeSet(runs, CHANGE_SET_ID)?.runId).toBe(RUN_ID);
  });

  it("returns undefined when the change set has no run at all", () => {
    expect(findLiveRunForChangeSet(runs, CHANGE_SET_ID)).toBeUndefined();
  });

  /**
   * The point of the helper: a run that has ALREADY finished (or was
   * cancelled, or blocked) must not stop the owner from starting a fresh
   * one. Treating any historical record as "live" would make a change set
   * un-runnable forever after its first failure.
   */
  it.each(["published_local", "failed", "blocked", "cancelled"] as const)(
    "does not report a run in the absorbing state %s as live",
    async (absorbing) => {
      changeSets.put(changeSet("ready"));
      await createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID });
      runs.upsert({ ...runs.get(RUN_ID)!, runState: absorbing });

      expect(findLiveRunForChangeSet(runs, CHANGE_SET_ID)).toBeUndefined();
    },
  );

  it("ignores runs belonging to a different change set", async () => {
    changeSets.put(changeSet("ready"));
    await createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID });

    expect(findLiveRunForChangeSet(runs, "77777777-7777-4777-8777-777777777777")).toBeUndefined();
  });
});

/**
 * Roast round 2, F6 — closed by the per-run serialization in
 * `run-transition.ts` rather than by anything here, so it is asserted at this
 * level to prove the fix reaches the caller that motivated it.
 *
 * Two concurrent `createRun` with the SAME caller-supplied runId both used to
 * see `runs.get() === undefined`, both validate `draft -> awaiting_approval`,
 * and both proceed — journalling the entire three-step walk twice. The
 * sequential test above asserted the transition table refuses a duplicate,
 * which was true only when nothing raced it.
 */
describe("createRun — concurrent calls with the same runId", () => {
  it("journals exactly one lifecycle walk", async () => {
    changeSets.put(changeSet("ready"));

    const outcomes = await Promise.allSettled([
      createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID }),
      createRun({ journal, runs, changeSets, changeSetId: CHANGE_SET_ID, runId: RUN_ID }),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);

    const transitions: { from: string; to: string }[] = [];
    for await (const entry of journal.queryEntries({ runId: RUN_ID })) {
      if (entry.type === "run_transition") {
        transitions.push(entry.payload as { from: string; to: string });
      }
    }
    expect(transitions).toEqual([
      { from: "draft", to: "awaiting_approval" },
      { from: "awaiting_approval", to: "ready" },
      { from: "ready", to: "running" },
    ]);
  });
});
