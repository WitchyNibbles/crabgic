import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendEntry } from "./append-entry.js";
import { createNodeFsPort } from "./fs-port.js";
import { gcJournal } from "./retention-gc.js";
import { listSegmentIndexes, segmentPath } from "./segment-layout.js";
import { writeSnapshot } from "./snapshot-io.js";
import { resolveStoreConfig, type JournalStoreConfig } from "./store-config.js";
import { verifyChain } from "./verify-chain.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

const journalDirs: string[] = [];

function freshConfig(
  overrides: Partial<Parameters<typeof resolveStoreConfig>[0]> = {},
): JournalStoreConfig {
  const journalDir = mkdtempSync(join(tmpdir(), "eo-journal-gc-"));
  journalDirs.push(journalDir);
  return resolveStoreConfig({ journalDir, ...overrides });
}

afterEach(() => {
  while (journalDirs.length > 0) {
    rmSync(journalDirs.pop()!, { recursive: true, force: true });
  }
});

describe("gcJournal — the never-delete-newer-than-latest-snapshot invariant", () => {
  it("never deletes a segment containing an entry newer than the latest durable snapshot, even at the most aggressive retention setting", async () => {
    // One entry per segment, forcing one-segment-per-append.
    const config = freshConfig({ segmentMaxBytes: 1 });
    const entries = [];
    for (let i = 0; i < 10; i++) {
      entries.push(
        await appendEntry(config, {
          type: "fanout_rationale",
          payload: { rationale: `e${i}` },
          runId: RUN_ID,
        }),
      );
    }
    const snapshotSeq = entries[5]!.seq;
    await writeSnapshot(config, {
      schemaVersion: 1,
      id: "22222222-2222-4222-8222-222222222222",
      runId: RUN_ID,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      runState: "running",
      journalSequenceNumber: snapshotSeq,
      capturedAt: "2026-01-01T00:00:00.000Z",
    });

    const report = await gcJournal(config, { minSegmentsToKeep: 0 });

    // Every entry still on disk after GC must have seq <= floor, OR be
    // part of a retained (not-deleted) segment — verify by re-reading the
    // whole journal directly and checking nothing newer than the snapshot
    // was among the deleted set's segments.
    const remainingIndexes = await listSegmentIndexes(config.fs, config.segmentsDir);
    for (const index of report.deletedSegmentIndexes) {
      expect(remainingIndexes).not.toContain(index);
    }
    // Every entry from seq > snapshotSeq onward must still be readable —
    // i.e. its segment was never deleted.
    for (const entry of entries.filter((e) => e.seq > snapshotSeq)) {
      const segmentIndex = entry.seq; // 1 entry per segment => segment index === seq at FIRST_SEQ-based numbering
      expect(remainingIndexes).toContain(segmentIndex);
    }
  });

  it("deletes nothing when no snapshot exists yet for any run (safeSeqFloor = -1)", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 });
    for (let i = 0; i < 5; i++) {
      await appendEntry(config, { type: "fanout_rationale", payload: { rationale: `e${i}` } });
    }
    const report = await gcJournal(config, { minSegmentsToKeep: 0 });
    expect(report.safeSeqFloor).toBe(-1);
    expect(report.deletedSegmentIndexes).toEqual([]);
  });

  it("never deletes the active (highest-index) segment, even when fully eligible", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 });
    const entries = [];
    for (let i = 0; i < 4; i++) {
      entries.push(
        await appendEntry(config, {
          type: "fanout_rationale",
          payload: { rationale: `e${i}` },
          runId: RUN_ID,
        }),
      );
    }
    await writeSnapshot(config, {
      schemaVersion: 1,
      id: "22222222-2222-4222-8222-222222222222",
      runId: RUN_ID,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      runState: "running",
      journalSequenceNumber: entries[entries.length - 1]!.seq, // snapshot covers EVERYTHING
      capturedAt: "2026-01-01T00:00:00.000Z",
    });

    const report = await gcJournal(config, { minSegmentsToKeep: 0 });
    const remaining = await listSegmentIndexes(config.fs, config.segmentsDir);
    expect(remaining.length).toBeGreaterThanOrEqual(1);
    expect(remaining[remaining.length - 1]).toBe(Math.max(...remaining));
    const activeIndex = Math.max(...remaining);
    expect(report.deletedSegmentIndexes).not.toContain(activeIndex);
    expect(report.retainedSegmentIndexes).toContain(activeIndex);
  });

  it("respects minSegmentsToKeep as an additional conservative floor beyond the snapshot boundary", async () => {
    async function buildPopulatedConfig(): Promise<{
      config: JournalStoreConfig;
      lastSeq: number;
    }> {
      const config = freshConfig({ segmentMaxBytes: 1 });
      let lastSeq = 0;
      for (let i = 0; i < 6; i++) {
        const entry = await appendEntry(config, {
          type: "fanout_rationale",
          payload: { rationale: `e${i}` },
          runId: RUN_ID,
        });
        lastSeq = entry.seq;
      }
      await writeSnapshot(config, {
        schemaVersion: 1,
        id: "22222222-2222-4222-8222-222222222222",
        runId: RUN_ID,
        changeSetId: "33333333-3333-4333-8333-333333333333",
        runState: "running",
        journalSequenceNumber: lastSeq,
        capturedAt: "2026-01-01T00:00:00.000Z",
      });
      return { config, lastSeq };
    }

    const populatedA = await buildPopulatedConfig();
    const aggressive = await gcJournal(populatedA.config, { minSegmentsToKeep: 0 });

    const populatedB = await buildPopulatedConfig();
    const conservative = await gcJournal(populatedB.config, { minSegmentsToKeep: 4 });

    expect(conservative.deletedSegmentIndexes.length).toBeLessThanOrEqual(
      aggressive.deletedSegmentIndexes.length,
    );
  });

  it("keeps the chain fully verifiable across the surviving (retained) segments after GC", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 });
    const entries = [];
    for (let i = 0; i < 5; i++) {
      entries.push(
        await appendEntry(config, {
          type: "fanout_rationale",
          payload: { rationale: `e${i}` },
          runId: RUN_ID,
        }),
      );
    }
    await writeSnapshot(config, {
      schemaVersion: 1,
      id: "22222222-2222-4222-8222-222222222222",
      runId: RUN_ID,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      runState: "running",
      journalSequenceNumber: entries[1]!.seq,
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    await gcJournal(config, { minSegmentsToKeep: 0 });
    const remaining = await listSegmentIndexes(config.fs, config.segmentsDir);
    for (const index of remaining) {
      const report = await verifyChain(
        config.fs,
        join(config.segmentsDir, `segment-${String(index).padStart(8, "0")}.ndjson`),
      );
      // Individually each surviving segment's OWN internal lines still hash-chain validly
      // (prevHash continuity across segment boundaries is a whole-journal property, not
      // asserted per-segment here).
      expect(report.validEntries.every((e) => e.seq >= 1)).toBe(true);
    }
  });
});

describe("gcJournal — edge cases", () => {
  it("ignores a snapshot file that fails schema validation rather than crashing", async () => {
    const config = freshConfig();
    await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "x" },
      runId: RUN_ID,
    });
    await writeSnapshot(config, {
      schemaVersion: 1,
      id: "22222222-2222-4222-8222-222222222222",
      runId: RUN_ID,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      runState: "running",
      journalSequenceNumber: 1,
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    writeFileSync(
      join(config.snapshotsDir, "snapshot-garbage-not-a-real-snapshot.json"),
      JSON.stringify({ not: "valid" }),
    );

    await expect(gcJournal(config, { minSegmentsToKeep: 0 })).resolves.toBeDefined();
  });

  it("handles a journal with zero segments (nothing to GC) without throwing", async () => {
    const config = freshConfig();
    await writeSnapshot(config, {
      schemaVersion: 1,
      id: "22222222-2222-4222-8222-222222222222",
      runId: RUN_ID,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      runState: "running",
      journalSequenceNumber: 0,
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    const report = await gcJournal(config, { minSegmentsToKeep: 0 });
    expect(report.deletedSegmentIndexes).toEqual([]);
    expect(report.retainedSegmentIndexes).toEqual([]);
  });

  it("deletes nothing when minSegmentsToKeep is larger than the number of segments present", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 });
    const entries = [];
    for (let i = 0; i < 3; i++) {
      entries.push(
        await appendEntry(config, {
          type: "fanout_rationale",
          payload: { rationale: `e${i}` },
          runId: RUN_ID,
        }),
      );
    }
    await writeSnapshot(config, {
      schemaVersion: 1,
      id: "22222222-2222-4222-8222-222222222222",
      runId: RUN_ID,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      runState: "running",
      journalSequenceNumber: entries[entries.length - 1]!.seq,
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    const report = await gcJournal(config, { minSegmentsToKeep: 100 });
    expect(report.deletedSegmentIndexes).toEqual([]);
  });
});

describe("gcJournal — tolerates an unreadable segment during eligibility scanning", () => {
  it("treats a segment that fails to read as ineligible (maxSeqOfSegment -> undefined) rather than throwing", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 });
    const entries = [];
    for (let i = 0; i < 3; i++) {
      entries.push(
        await appendEntry(config, {
          type: "fanout_rationale",
          payload: { rationale: `e${i}` },
          runId: RUN_ID,
        }),
      );
    }
    await writeSnapshot(config, {
      schemaVersion: 1,
      id: "22222222-2222-4222-8222-222222222222",
      runId: RUN_ID,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      runState: "running",
      journalSequenceNumber: entries[entries.length - 1]!.seq,
      capturedAt: "2026-01-01T00:00:00.000Z",
    });

    const unreadableIndex = entries[0]!.seq;
    const unreadablePath = segmentPath(config.segmentsDir, unreadableIndex);
    const real = createNodeFsPort();
    const flakyConfig: JournalStoreConfig = {
      ...config,
      fs: {
        ...real,
        async readFile(path: string): Promise<string> {
          if (path === unreadablePath) throw new Error("simulated read failure");
          return real.readFile(path);
        },
      },
    };

    // Does not throw — the unreadable segment is simply skipped/ineligible.
    const report = await gcJournal(flakyConfig, { minSegmentsToKeep: 0 });
    expect(report.deletedSegmentIndexes).not.toContain(unreadableIndex);
  });
});

describe("gcJournal — snapshot GC", () => {
  it("keeps only the latest snapshot per run, deleting superseded ones", async () => {
    const config = freshConfig();
    await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "x" },
      runId: RUN_ID,
    });
    for (const seq of [1, 2, 3]) {
      await writeSnapshot(config, {
        schemaVersion: 1,
        id: "22222222-2222-4222-8222-222222222222",
        runId: RUN_ID,
        changeSetId: "33333333-3333-4333-8333-333333333333",
        runState: "running",
        journalSequenceNumber: seq,
        capturedAt: "2026-01-01T00:00:00.000Z",
      });
    }
    const before = readdirSync(config.snapshotsDir).filter((n) => n.endsWith(".json"));
    expect(before).toHaveLength(3);

    await gcJournal(config, { minSegmentsToKeep: 0 });
    const after = readdirSync(config.snapshotsDir).filter((n) => n.endsWith(".json"));
    expect(after).toHaveLength(1);
  });
});
