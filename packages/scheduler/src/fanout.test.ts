import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJournalStore, type JournalStore } from "@eo/journal";
import type { CollisionVerdict } from "@eo/git-engine";
import {
  DEFAULT_CONCURRENCY_CAP,
  journalFanoutRationaleIfFannedOut,
  selectDispatchSet,
} from "./fanout.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const E = "eeeeeeee-0000-4000-8000-000000000005";

describe("selectDispatchSet", () => {
  it("selects a single ready unit with no collisions", () => {
    expect(selectDispatchSet([A], [])).toEqual([A]);
  });

  it("serializes two colliding ready units — only the first (in input order) is selected", () => {
    const verdicts: CollisionVerdict[] = [
      { unitA: A, unitB: B, collides: true, collidingPaths: ["x"], declaredResourceCollisions: [] },
    ];
    expect(selectDispatchSet([A, B], verdicts)).toEqual([A]);
  });

  it("fans out two independent (non-colliding) ready units together", () => {
    const verdicts: CollisionVerdict[] = [
      { unitA: A, unitB: B, collides: false, collidingPaths: [], declaredResourceCollisions: [] },
    ];
    expect(selectDispatchSet([A, B], verdicts)).toEqual([A, B]);
  });

  it("never exceeds the default concurrency cap of 4", () => {
    const ids = [A, B, C, D, E];
    expect(selectDispatchSet(ids, [])).toHaveLength(DEFAULT_CONCURRENCY_CAP);
    expect(selectDispatchSet(ids, [])).toEqual([A, B, C, D]);
  });

  it("honors a caller-supplied narrower concurrency cap", () => {
    expect(selectDispatchSet([A, B, C], [], 2)).toEqual([A, B]);
  });

  it("a unit that collides with an already-selected unit is skipped even if it doesn't collide with anything else", () => {
    // A-B collide; B-C do not collide with each other, but B is skipped
    // once A is chosen, so C should still be selectable alongside A.
    const verdicts: CollisionVerdict[] = [
      { unitA: A, unitB: B, collides: true, collidingPaths: ["x"], declaredResourceCollisions: [] },
    ];
    expect(selectDispatchSet([A, B, C], verdicts)).toEqual([A, C]);
  });
});

let journalDir: string;
let store: JournalStore;

beforeEach(async () => {
  journalDir = await mkdtemp(join(tmpdir(), "eo-scheduler-fanout-"));
  store = createJournalStore({ journalDir });
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

describe("journalFanoutRationaleIfFannedOut", () => {
  it("journals nothing for a single-unit dispatch (the default, non-fan-out case)", async () => {
    await journalFanoutRationaleIfFannedOut({ journal: store, dispatchedUnitIds: [A] });
    const entries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "fanout_rationale" })) entries.push(entry);
    expect(entries).toHaveLength(0);
  });

  it("journals nothing for an empty dispatch set", async () => {
    await journalFanoutRationaleIfFannedOut({ journal: store, dispatchedUnitIds: [] });
    const entries: unknown[] = [];
    for await (const entry of store.queryEntries({ type: "fanout_rationale" })) entries.push(entry);
    expect(entries).toHaveLength(0);
  });

  it("journals exactly one fanout_rationale entry naming every dispatched unit and an expected token cost, for a >1-unit dispatch", async () => {
    await journalFanoutRationaleIfFannedOut({
      journal: store,
      dispatchedUnitIds: [A, B, C],
      runId: "11111111-1111-4111-8111-111111111111",
    });
    const entries: { type: string; payload: { rationale: string } }[] = [];
    for await (const entry of store.queryEntries({ type: "fanout_rationale" })) {
      entries.push(entry as (typeof entries)[number]);
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload.rationale).toContain(A);
    expect(entries[0]?.payload.rationale).toContain(B);
    expect(entries[0]?.payload.rationale).toContain(C);
    expect(entries[0]?.payload.rationale).toMatch(/expected token cost/i);
  });

  it("threads a caller-supplied changeSetId onto the fanout_rationale entry", async () => {
    const changeSetId = "99999999-9999-4999-8999-999999999999";
    await journalFanoutRationaleIfFannedOut({
      journal: store,
      dispatchedUnitIds: [A, B],
      changeSetId,
    });
    const entries: { changeSetId?: string }[] = [];
    for await (const entry of store.queryEntries({ type: "fanout_rationale" })) {
      entries.push(entry as { changeSetId?: string });
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]?.changeSetId).toBe(changeSetId);
  });
});
