import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import { RUN_LIFECYCLE_STATES, type RunLifecycleState } from "@eo/contracts";
import { buildChangeSet, buildStackEvidence } from "@eo/testkit";
import { createChangeSetsRegistry } from "../registries/change-sets-registry.js";
import { runProjectInspect } from "./project-inspect.js";

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-supervisor-project-inspect-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("runProjectInspect", () => {
  it("returns a valid partial report — no error — against a fresh, empty journal with no ChangeSets", async () => {
    const changeSets = createChangeSetsRegistry();
    const report = await runProjectInspect({ journal: store, changeSets });

    expect(report.freeze).toBeUndefined();
    expect(report.stackEvidence).toBeUndefined();
    expect(report.changeSets).toEqual([]);
    expect(report.degraded.length).toBeGreaterThan(0);
  });

  it("surfaces the most recent git_freeze entry when present", async () => {
    const changeSets = createChangeSetsRegistry();
    await store.appendEntry({
      type: "git_freeze",
      payload: { scopePath: ".", reason: "first freeze" },
    });
    await store.appendEntry({
      type: "git_freeze",
      payload: { scopePath: ".", reason: "second freeze" },
    });

    const report = await runProjectInspect({ journal: store, changeSets });
    expect(report.freeze?.reason).toBe("second freeze");
  });

  it("a same-or-earlier-timestamped later entry never displaces the current latest freeze", async () => {
    const changeSets = createChangeSetsRegistry();
    // A synthetic journal (not @eo/journal's real appendEntry, which always
    // increases the timestamp) whose second yielded entry is NOT newer than
    // the first — exercises the "not replaced" branch directly.
    const fixedJournal = {
      queryEntries: async function* () {
        yield {
          schemaVersion: 1 as const,
          seq: 1,
          prevHash: "0".repeat(64),
          hash: "1".repeat(64),
          timestamp: "2026-01-02T00:00:00.000Z",
          type: "git_freeze" as const,
          payload: { scopePath: ".", reason: "later seq, earlier timestamp" },
        };
        // A defensively-typed non-"git_freeze" entry mixed in (never
        // actually produced by a real `queryEntries({type:"git_freeze"})`
        // call, but a valid `JournalEntry` shape) — exercises this
        // function's own `continue` guard directly.
        yield {
          schemaVersion: 1 as const,
          seq: 2,
          prevHash: "1".repeat(64),
          hash: "2".repeat(64),
          timestamp: "2026-01-03T00:00:00.000Z",
          type: "run_transition" as const,
          payload: { from: "draft" as const, to: "awaiting_approval" as const },
        };
        yield {
          schemaVersion: 1 as const,
          seq: 3,
          prevHash: "2".repeat(64),
          hash: "3".repeat(64),
          timestamp: "2026-01-01T00:00:00.000Z",
          type: "git_freeze" as const,
          payload: { scopePath: ".", reason: "should not win" },
        };
      },
    };
    const report = await runProjectInspect({ journal: fixedJournal, changeSets });
    expect(report.freeze?.reason).toBe("later seq, earlier timestamp");
  });

  it("folds in StackEvidence when a provider is supplied and resolves one", async () => {
    const changeSets = createChangeSetsRegistry();
    const evidence = buildStackEvidence();
    const report = await runProjectInspect({
      journal: store,
      changeSets,
      stackEvidenceProvider: async () => evidence,
    });
    expect(report.stackEvidence).toEqual(evidence);
    expect(report.degraded.some((d) => d.includes("StackEvidence"))).toBe(false);
  });

  it("degrades gracefully when the StackEvidence provider resolves undefined (pre-12 case)", async () => {
    const changeSets = createChangeSetsRegistry();
    const report = await runProjectInspect({
      journal: store,
      changeSets,
      stackEvidenceProvider: async () => undefined,
    });
    expect(report.stackEvidence).toBeUndefined();
    expect(report.degraded.some((d) => d.includes("StackEvidence"))).toBe(true);
  });

  it("answers correct ChangeSet-state queries across a fixture set spanning every run-lifecycle stage", async () => {
    const changeSets = createChangeSetsRegistry();
    const fixtures = RUN_LIFECYCLE_STATES.map((state: RunLifecycleState, i) =>
      buildChangeSet({
        state,
        id: `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
      }),
    );
    for (const cs of fixtures) changeSets.put(cs);

    const listing = await runProjectInspect({ journal: store, changeSets });
    expect(listing.changeSets).toHaveLength(RUN_LIFECYCLE_STATES.length);

    for (const cs of fixtures) {
      const single = await runProjectInspect(
        { journal: store, changeSets },
        { changeSetId: cs.id },
      );
      expect(single.changeSets).toEqual([cs]);
      expect(single.changeSets[0]!.state).toBe(cs.state);
    }
  });

  it("a query for an unknown ChangeSet id returns an empty result with a degraded note, not a throw", async () => {
    const changeSets = createChangeSetsRegistry();
    const report = await runProjectInspect(
      { journal: store, changeSets },
      { changeSetId: "99999999-9999-4999-8999-999999999999" },
    );
    expect(report.changeSets).toEqual([]);
    expect(report.degraded.some((d) => d.includes("no ChangeSet found"))).toBe(true);
  });
});
