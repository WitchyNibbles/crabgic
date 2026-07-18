import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendEntry } from "./append-entry.js";
import { loadLatestSnapshot, recover, writeSnapshot } from "./snapshot-io.js";
import { resolveStoreConfig, type JournalStoreConfig } from "./store-config.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_SET_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RUN_ID = "33333333-3333-4333-8333-333333333333";

let journalDir: string | undefined;

function freshConfig(): JournalStoreConfig {
  journalDir = mkdtempSync(join(tmpdir(), "eo-journal-snapshot-"));
  return resolveStoreConfig({ journalDir });
}

function sampleSnapshot(overrides: Partial<Parameters<typeof writeSnapshot>[1]> = {}) {
  return {
    schemaVersion: 1 as const,
    id: "44444444-4444-4444-8444-444444444444",
    runId: RUN_ID,
    changeSetId: CHANGE_SET_ID,
    runState: "running" as const,
    journalSequenceNumber: 0,
    capturedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  if (journalDir !== undefined) rmSync(journalDir, { recursive: true, force: true });
  journalDir = undefined;
});

describe("writeSnapshot / loadLatestSnapshot — real filesystem", () => {
  it("round-trips a snapshot written and then loaded back", async () => {
    const config = freshConfig();
    const snapshot = sampleSnapshot({ journalSequenceNumber: 3 });
    await writeSnapshot(config, snapshot);
    const loaded = await loadLatestSnapshot(config, RUN_ID);
    expect(loaded).toEqual(snapshot);
  });

  it("returns undefined when no snapshot exists for the run", async () => {
    const config = freshConfig();
    expect(await loadLatestSnapshot(config, RUN_ID)).toBeUndefined();
  });

  it("picks the snapshot with the highest journalSequenceNumber among several for the same run", async () => {
    const config = freshConfig();
    await writeSnapshot(config, sampleSnapshot({ journalSequenceNumber: 1 }));
    await writeSnapshot(config, sampleSnapshot({ journalSequenceNumber: 5 }));
    await writeSnapshot(config, sampleSnapshot({ journalSequenceNumber: 3 }));

    const loaded = await loadLatestSnapshot(config, RUN_ID);
    expect(loaded?.journalSequenceNumber).toBe(5);
  });

  it("never mixes up snapshots belonging to different runs", async () => {
    const config = freshConfig();
    await writeSnapshot(
      config,
      sampleSnapshot({
        id: "44444444-4444-4444-8444-444444444444",
        runId: RUN_ID,
        journalSequenceNumber: 1,
      }),
    );
    await writeSnapshot(
      config,
      sampleSnapshot({
        id: "77777777-7777-4777-8777-777777777777",
        runId: OTHER_RUN_ID,
        journalSequenceNumber: 99,
      }),
    );
    const loaded = await loadLatestSnapshot(config, RUN_ID);
    expect(loaded?.runId).toBe(RUN_ID);
    expect(loaded?.journalSequenceNumber).toBe(1);
  });

  it("writes the snapshots directory at 0700 and the snapshot file at 0600", async () => {
    const config = freshConfig();
    await writeSnapshot(config, sampleSnapshot());
    expect(statSync(config.snapshotsDir).mode & 0o777).toBe(0o700);
    const [fileName] = readdirSync(config.snapshotsDir).filter((n) => n.endsWith(".json"));
    expect(statSync(join(config.snapshotsDir, fileName!)).mode & 0o777).toBe(0o600);
  });

  it("re-writing the same (runId, journalSequenceNumber) overwrites the same file rather than accumulating", async () => {
    const config = freshConfig();
    await writeSnapshot(config, sampleSnapshot({ journalSequenceNumber: 2, runState: "running" }));
    await writeSnapshot(
      config,
      sampleSnapshot({ journalSequenceNumber: 2, runState: "verifying" }),
    );
    const files = readdirSync(config.snapshotsDir).filter((n) => n.endsWith(".json"));
    expect(files).toHaveLength(1);
    const loaded = await loadLatestSnapshot(config, RUN_ID);
    expect(loaded?.runState).toBe("verifying");
  });
});

describe("recover", () => {
  it("with no snapshot, replays every journal entry belonging to the run", async () => {
    const config = freshConfig();
    const e1 = await appendEntry(config, {
      type: "run_transition",
      payload: { from: "draft", to: "awaiting_approval" },
      runId: RUN_ID,
    });
    const e2 = await appendEntry(config, {
      type: "run_transition",
      payload: { from: "awaiting_approval", to: "ready" },
      runId: RUN_ID,
    });
    await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "unrelated run" },
      runId: OTHER_RUN_ID,
    });

    const result = await recover(config, RUN_ID);
    expect(result.snapshot).toBeUndefined();
    expect(result.replayed).toEqual([e1, e2]);
  });

  it("with a snapshot, replays only entries strictly after its journalSequenceNumber", async () => {
    const config = freshConfig();
    const e1 = await appendEntry(config, {
      type: "run_transition",
      payload: { from: "draft", to: "awaiting_approval" },
      runId: RUN_ID,
    });
    await writeSnapshot(
      config,
      sampleSnapshot({ journalSequenceNumber: e1.seq, runState: "awaiting_approval" }),
    );
    const e2 = await appendEntry(config, {
      type: "run_transition",
      payload: { from: "awaiting_approval", to: "ready" },
      runId: RUN_ID,
    });

    const result = await recover(config, RUN_ID);
    expect(result.snapshot?.journalSequenceNumber).toBe(e1.seq);
    expect(result.replayed).toEqual([e2]);
  });

  it("a parked:rate_limit work_unit_transition entry retains its sessionId across a simulated crash+recover cycle", async () => {
    const config = freshConfig();
    const sessionId = "55555555-5555-4555-8555-555555555555";
    const workUnitId = "66666666-6666-4666-8666-666666666666";

    await appendEntry(config, {
      type: "work_unit_transition",
      payload: { status: "dispatched", sessionId },
      runId: RUN_ID,
      workUnitId,
    });
    const parked = await appendEntry(config, {
      type: "work_unit_transition",
      payload: { status: "parked:rate_limit", previousStatus: "dispatched", sessionId },
      runId: RUN_ID,
      workUnitId,
    });

    // Simulate a crash + fresh process: build an entirely new store pointed
    // at the same real directory (no in-process state carries over).
    const freshProcessConfig = resolveStoreConfig({ journalDir: journalDir! });
    const result = await recover(freshProcessConfig, RUN_ID);

    const recoveredParked = result.replayed.find((e) => e.seq === parked.seq);
    expect(recoveredParked?.type).toBe("work_unit_transition");
    if (recoveredParked === undefined || recoveredParked.type !== "work_unit_transition") {
      throw new Error("unreachable");
    }
    expect(recoveredParked.payload.status).toBe("parked:rate_limit");
    expect(recoveredParked.payload.sessionId).toBe(sessionId);
  });
});
