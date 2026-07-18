import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { FIRST_SEQ } from "./codec/journal-entry.js";
import { segmentPath } from "./store/segment-layout.js";
import { verifyChain } from "./store/verify-chain.js";
import { createJournalStore, type JournalStore } from "./store/journal-store.js";
import { getLatestAttempt, recordAttempt, toAttemptRecord } from "./attempts.js";
import type { JournalEntry } from "./codec/journal-entry.js";

const dirsToClean: string[] = [];

function freshStore(): { store: JournalStore; journalDir: string } {
  const journalDir = mkdtempSync(join(tmpdir(), "eo-journal-attempts-"));
  dirsToClean.push(journalDir);
  return { store: createJournalStore({ journalDir }), journalDir };
}

afterEach(() => {
  while (dirsToClean.length > 0) {
    rmSync(dirsToClean.pop()!, { recursive: true, force: true });
  }
});

describe("recordAttempt — basic persistence", () => {
  it("persists a work_unit_transition entry carrying workUnitId, sessionId, and status", async () => {
    const { store } = freshStore();
    const workUnitId = randomUUID();
    const sessionId = randomUUID();

    const record = await recordAttempt(store, workUnitId, sessionId, "dispatched");

    expect(record.workUnitId).toBe(workUnitId);
    expect(record.sessionId).toBe(sessionId);
    expect(record.status).toBe("dispatched");
    expect(record.previousStatus).toBeUndefined();

    const entries = [];
    for await (const entry of store.queryEntries({ type: "work_unit_transition" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(1);
    if (entries[0]?.type === "work_unit_transition") {
      expect(entries[0].workUnitId).toBe(workUnitId);
      expect(entries[0].payload.sessionId).toBe(sessionId);
      expect(entries[0].payload.status).toBe("dispatched");
    }
  });

  it("auto-populates previousStatus from the prior recorded attempt for the same work unit", async () => {
    const { store } = freshStore();
    const workUnitId = randomUUID();
    const sessionId = randomUUID();

    await recordAttempt(store, workUnitId, sessionId, "dispatched");
    const second = await recordAttempt(store, workUnitId, sessionId, "parked:rate_limit");

    expect(second.previousStatus).toBe("dispatched");
    expect(second.status).toBe("parked:rate_limit");
  });
});

describe("getLatestAttempt — read-back path", () => {
  it("returns undefined when no attempts exist for a work unit", async () => {
    const { store } = freshStore();
    const latest = await getLatestAttempt(store, randomUUID());
    expect(latest).toBeUndefined();
  });

  it("returns the LATEST (highest seq) attempt, not the first", async () => {
    const { store } = freshStore();
    const workUnitId = randomUUID();
    const sessionId = randomUUID();

    await recordAttempt(store, workUnitId, sessionId, "dispatched");
    await recordAttempt(store, workUnitId, sessionId, "parked:rate_limit");
    const third = await recordAttempt(store, workUnitId, sessionId, "dispatched");

    const latest = await getLatestAttempt(store, workUnitId);
    expect(latest?.status).toBe("dispatched");
    expect(latest?.seq).toBe(third.seq);
  });

  it("ignores attempts belonging to OTHER work units", async () => {
    const { store } = freshStore();
    const workUnitA = randomUUID();
    const workUnitB = randomUUID();
    const sessionId = randomUUID();

    await recordAttempt(store, workUnitA, sessionId, "dispatched");
    await recordAttempt(store, workUnitB, sessionId, "succeeded");

    const latestA = await getLatestAttempt(store, workUnitA);
    expect(latestA?.status).toBe("dispatched");
    expect(latestA?.workUnitId).toBe(workUnitA);
  });
});

describe("toAttemptRecord — defensive type guard", () => {
  it("throws when given a JournalEntry that is NOT a work_unit_transition (should never happen through the normal query path, guarded defensively)", () => {
    const wrongTypeEntry = {
      schemaVersion: 1,
      seq: 1,
      type: "fanout_rationale",
      payload: { rationale: "not-an-attempt" },
      prevHash: "0".repeat(64),
      hash: "1".repeat(64),
      timestamp: "2026-01-01T00:00:00.000Z",
    } as unknown as JournalEntry;

    expect(() => toAttemptRecord(wrongTypeEntry)).toThrow(/expected a work_unit_transition entry/);
  });
});

describe("EXIT CRITERION: a parked:rate_limit attempt retains session_id across a simulated crash+recover cycle", () => {
  it("survives a torn-tail crash immediately after it, and read-back through recordAttempt/getLatestAttempt still reports the exact session_id", async () => {
    const { store, journalDir } = freshStore();
    const workUnitId = randomUUID();
    const sessionId = randomUUID();

    await recordAttempt(store, workUnitId, sessionId, "dispatched");
    const parked = await recordAttempt(store, workUnitId, sessionId, "parked:rate_limit");
    expect(parked.sessionId).toBe(sessionId);

    // Simulate a crash: one more entry starts writing (e.g. a subsequent
    // resume attempt beginning its own append) and is torn mid-write —
    // exactly the "simulate torn state" allowance this exit criterion's
    // brief offers as an alternative to a real kill-harness run (see
    // journal-recovery-properties.test.ts for the same technique, applied
    // there to arbitrary entries; this test targets the SPECIFIC payload
    // field — session_id — the exit criterion names).
    await store.appendEntry({
      type: "work_unit_transition",
      workUnitId,
      payload: { status: "dispatched", previousStatus: "parked:rate_limit", sessionId },
    });

    const path = segmentPath(store.config.segmentsDir, FIRST_SEQ);
    const full = readFileSync(path, "utf8");
    const lastNewline = full.lastIndexOf("\n", full.length - 2);
    // Cut strictly inside the last (most recent) entry's bytes — a torn
    // write that never completed, leaving the PRIOR entry (the
    // parked:rate_limit one under test) as the last fully valid entry.
    writeFileSync(path, full.slice(0, lastNewline + 1 + 3));

    const beforeRepair = await verifyChain(store.config.fs, path);
    expect(beforeRepair.firstIssue).toBeDefined();

    // API CHANGE (VALIDATION ROUND 2026-07-18, MAJOR 1 fix): the store no
    // longer exposes a per-segment `repairChain` convenience method — use
    // the safe, whole-journal-aware `repairJournal()` instead.
    await store.repairJournal();

    const afterRepair = await verifyChain(store.config.fs, path);
    expect(afterRepair.firstIssue).toBeUndefined();

    // Recovery: the read-back path must still report the parked:rate_limit
    // attempt as the latest surviving one, with session_id fully intact —
    // this is the property "a later `resume` can continue the same engine
    // conversation" depends on (roadmap/04 §In scope).
    const recovered = await getLatestAttempt(store, workUnitId);
    expect(recovered?.status).toBe("parked:rate_limit");
    expect(recovered?.sessionId).toBe(sessionId);
    expect(journalDir.length).toBeGreaterThan(0);
  });
});
