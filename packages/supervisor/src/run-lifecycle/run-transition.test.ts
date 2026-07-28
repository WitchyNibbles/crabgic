import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@crabgic/journal";
import { IllegalTransitionError } from "@crabgic/contracts";
import { transitionRun } from "./run-transition.js";
import { createRunsRegistry } from "../registries/runs-registry.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-run-transition-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("transitionRun", () => {
  it("journals run_transition and updates the RunsRegistry for a legal transition", async () => {
    const runs = createRunsRegistry();
    const record = await transitionRun({
      journal: store,
      runs,
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      to: "awaiting_approval",
    });

    expect(record.runState).toBe("awaiting_approval");
    expect(runs.get(RUN_ID)?.runState).toBe("awaiting_approval");

    const entries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "run_transition", runId: RUN_ID })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
  });

  it("chains multiple legal transitions, starting from the previous RunRecord's own state", async () => {
    const runs = createRunsRegistry();
    await transitionRun({
      journal: store,
      runs,
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      to: "awaiting_approval",
    });
    await transitionRun({
      journal: store,
      runs,
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      to: "ready",
    });
    const record = await transitionRun({
      journal: store,
      runs,
      runId: RUN_ID,
      changeSetId: CHANGE_SET_ID,
      to: "running",
    });
    expect(record.runState).toBe("running");
  });

  it("throws IllegalTransitionError for an illegal transition, BEFORE any journal write", async () => {
    const runs = createRunsRegistry();
    await expect(
      transitionRun({
        journal: store,
        runs,
        runId: RUN_ID,
        changeSetId: CHANGE_SET_ID,
        to: "published_local", // draft -> published_local is not a legal edge
      }),
    ).rejects.toBeInstanceOf(IllegalTransitionError);

    const entries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "run_transition", runId: RUN_ID })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(0);
    expect(runs.get(RUN_ID)).toBeUndefined();
  });
});

/**
 * Roast round 2, F3 — PROVEN before it was fixed.
 *
 * `transitionRun` read `from` before `await journal.appendEntry(...)` and
 * upserted the registry after: a read-modify-write straddling an await. Two
 * concurrent transitions on one run therefore both saw the same `from`, both
 * validated against it, and both wrote -- producing a journal containing two
 * outgoing edges from a single state, in the record this module's own doc
 * comment calls the audit record. `createRun` performs three of these back to
 * back, and `run.cancel` racing that walk is the ordinary way to hit it.
 * Which value survived in the registry was decided by filesystem append
 * order.
 */
describe("transitionRun — concurrent transitions on one run", () => {
  async function readTransitions(runId: string): Promise<{ from: string; to: string }[]> {
    const out: { from: string; to: string }[] = [];
    for await (const entry of store.queryEntries({ runId })) {
      if (entry.type === "run_transition") out.push(entry.payload as { from: string; to: string });
    }
    return out;
  }

  /**
   * The invariant is that the journal reads as a CHAIN — each transition's
   * `from` is the previous one's `to` — not that one racer loses. Once the
   * race is serialized both may legitimately succeed: `ready -> running`
   * followed by `running -> cancelled` are both legal edges, and cancelling a
   * run that just started is a real thing an operator does. What must never
   * happen is two transitions claiming the same `from`.
   */
  it("serializes a race so the journal reads as a chain, not two edges out of one state", async () => {
    const runs = createRunsRegistry();
    const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const changeSetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const base = { journal: store, runs, runId, changeSetId } as const;

    await transitionRun({ ...base, to: "awaiting_approval" });
    await transitionRun({ ...base, to: "ready" });

    // `ready` legally goes to `running` OR `cancelled` -- never both.
    const outcomes = await Promise.allSettled([
      transitionRun({ ...base, to: "running" }),
      transitionRun({ ...base, to: "cancelled" }),
    ]);

    // Every settled outcome is legitimate; what matters is what was written.
    expect(outcomes.filter((o) => o.status === "fulfilled").length).toBeGreaterThan(0);

    const transitions = await readTransitions(runId);
    // No state is departed from twice...
    const froms = transitions.map((t) => t.from);
    expect(new Set(froms).size).toBe(froms.length);
    // ...and each transition continues the previous one.
    for (let i = 1; i < transitions.length; i += 1) {
      expect(transitions[i]!.from).toBe(transitions[i - 1]!.to);
    }
  });

  it("leaves the registry agreeing with the last journalled transition", async () => {
    const runs = createRunsRegistry();
    const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const changeSetId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const base = { journal: store, runs, runId, changeSetId } as const;

    await transitionRun({ ...base, to: "awaiting_approval" });
    await Promise.allSettled([
      transitionRun({ ...base, to: "ready" }),
      transitionRun({ ...base, to: "cancelled" }),
      transitionRun({ ...base, to: "blocked" }),
    ]);

    const transitions = await readTransitions(runId);
    expect(runs.get(runId)?.runState).toBe(transitions[transitions.length - 1]!.to);
  });

  /** Different runs must not queue behind each other — serialization is per run, not global. */
  it("does not serialize unrelated runs against each other", async () => {
    const runs = createRunsRegistry();
    const changeSetId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    await Promise.all(
      ids.map((runId) =>
        transitionRun({ journal: store, runs, runId, changeSetId, to: "awaiting_approval" }),
      ),
    );

    for (const runId of ids) expect(runs.get(runId)?.runState).toBe("awaiting_approval");
  });
});
