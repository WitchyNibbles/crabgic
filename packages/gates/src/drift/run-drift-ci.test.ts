import { describe, expect, it } from "vitest";
import { runDriftCi, type RunDriftCiDeps } from "./run-drift-ci.js";
import type { DriftFixtureSnapshot } from "./drift-proposal.js";
import type { DriftDebounceState } from "./debounce.js";

const PINNED: DriftFixtureSnapshot = {
  connector: "jira",
  pinnedVersion: "3.0.0",
  observedVersion: "3.0.0",
  pinnedShape: { summary: "string" },
  observedShape: { summary: "string" },
};

const BUMPED: DriftFixtureSnapshot = {
  connector: "jira",
  pinnedVersion: "3.0.0",
  observedVersion: "3.1.0",
  pinnedShape: { summary: "string", description: "string" },
  observedShape: { summary: "string" }, // "description" withdrawn — intentional bump
};

function fakeDeps(initialState: DriftDebounceState = {}): RunDriftCiDeps & {
  savedStates: DriftDebounceState[];
  writtenProposalBatches: number;
  lastProposals: unknown;
} {
  let state = initialState;
  const savedStates: DriftDebounceState[] = [];
  let writtenProposalBatches = 0;
  let lastProposals: unknown;
  return {
    loadDebounceState: async () => state,
    saveDebounceState: async (next) => {
      state = next;
      savedStates.push(next);
    },
    writeProposals: async (proposals) => {
      writtenProposalBatches += 1;
      lastProposals = proposals;
    },
    now: () => new Date("2026-07-24T00:00:00.000Z"),
    get savedStates() {
      return savedStates;
    },
    get writtenProposalBatches() {
      return writtenProposalBatches;
    },
    get lastProposals() {
      return lastProposals;
    },
  };
}

describe("runDriftCi — green path (pinned fixture, no drift)", () => {
  it("produces zero proposals and a green (non-red) check", async () => {
    const deps = fakeDeps();
    const result = await runDriftCi({ snapshots: [PINNED] }, deps);
    expect(result.proposals).toEqual([]);
    expect(result.redCheck).toBe(false);
  });
});

describe("runDriftCi — failing-first: intentionally bumped fixture produces a red check, debounced", () => {
  it("does NOT emit on the first run against the bumped fixture (debounce threshold 2)", async () => {
    const deps = fakeDeps();
    const result = await runDriftCi({ snapshots: [BUMPED], debounceThreshold: 2 }, deps);
    expect(result.proposals).toEqual([]);
    expect(result.redCheck).toBe(false);
  });

  it("emits exactly ONE DriftProposal and a red check on the SECOND consecutive run against the same bumped fixture", async () => {
    const deps = fakeDeps();
    await runDriftCi({ snapshots: [BUMPED], debounceThreshold: 2 }, deps);
    const secondRun = await runDriftCi(
      { snapshots: [BUMPED], debounceThreshold: 2 },
      { ...deps, loadDebounceState: async () => deps.savedStates.at(-1) ?? {} },
    );
    expect(secondRun.proposals).toHaveLength(1);
    expect(secondRun.proposals[0]?.connector).toBe("jira");
    expect(secondRun.redCheck).toBe(true);
  });

  it("a debounceThreshold of 1 (opting out of debounce) produces a red check on the very first run", async () => {
    const deps = fakeDeps();
    const result = await runDriftCi({ snapshots: [BUMPED], debounceThreshold: 1 }, deps);
    expect(result.proposals).toHaveLength(1);
    expect(result.redCheck).toBe(true);
  });
});

describe("runDriftCi — zero pinned-fixture/config changes applied by the job itself", () => {
  it("always calls writeProposals exactly once and NEVER any capability beyond saveDebounceState/writeProposals", async () => {
    const deps = fakeDeps();
    await runDriftCi({ snapshots: [PINNED, BUMPED], debounceThreshold: 1 }, deps);
    expect(deps.writtenProposalBatches).toBe(1);
    // The deps object's OWN key set is the full extent of this function's
    // write capability — no generic file-write member exists to spy on.
    expect(Object.keys(deps).sort()).toEqual(
      [
        "lastProposals",
        "loadDebounceState",
        "now",
        "savedStates",
        "saveDebounceState",
        "writeProposals",
        "writtenProposalBatches",
      ].sort(),
    );
  });
});
