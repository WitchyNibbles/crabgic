import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { IllegalTransitionError } from "@eo/contracts";
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
