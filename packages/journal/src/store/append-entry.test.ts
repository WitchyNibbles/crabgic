import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GENESIS_PREV_HASH } from "../codec/hash-chain.js";
import { FIRST_SEQ } from "../codec/journal-entry.js";
import { appendEntry, JournalCorruptedTailError, readLastEntry } from "./append-entry.js";
import { listSegmentIndexes, segmentPath } from "./segment-layout.js";
import { resolveStoreConfig, type JournalStoreConfig } from "./store-config.js";

let journalDir: string | undefined;

function freshConfig(
  overrides: Partial<Parameters<typeof resolveStoreConfig>[0]> = {},
): JournalStoreConfig {
  journalDir = mkdtempSync(join(tmpdir(), "eo-journal-append-"));
  return resolveStoreConfig({ journalDir, ...overrides });
}

afterEach(() => {
  if (journalDir !== undefined) rmSync(journalDir, { recursive: true, force: true });
  journalDir = undefined;
});

describe("appendEntry — real filesystem", () => {
  it("assigns schemaVersion, seq=FIRST_SEQ, prevHash=GENESIS_PREV_HASH, and a valid hash to the first entry", async () => {
    const config = freshConfig();
    const entry = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "first" },
    });
    expect(entry.schemaVersion).toBe(1);
    expect(entry.seq).toBe(FIRST_SEQ);
    expect(entry.prevHash).toBe(GENESIS_PREV_HASH);
    expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains seq/prevHash monotonically across sequential appends", async () => {
    const config = freshConfig();
    const e1 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "one" },
    });
    const e2 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "two" },
    });
    const e3 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "three" },
    });

    expect(e2.seq).toBe(e1.seq + 1);
    expect(e3.seq).toBe(e2.seq + 1);
    expect(e2.prevHash).toBe(e1.hash);
    expect(e3.prevHash).toBe(e2.hash);
  });

  it("persists each entry as its own ndjson line, byte-readable back from disk", async () => {
    const config = freshConfig();
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "a" } });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "b" } });
    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const content = readFileSync(path, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).payload.rationale).toBe("a");
    expect(JSON.parse(lines[1]!).payload.rationale).toBe("b");
  });

  it("creates the segments directory at 0700 and segment files at 0600", async () => {
    const config = freshConfig();
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "perm-check" } });
    expect(statSync(config.segmentsDir).mode & 0o777).toBe(0o700);
    expect(statSync(segmentPath(config.segmentsDir, FIRST_SEQ)).mode & 0o777).toBe(0o600);
  });

  it("rotates to a new segment once the size threshold is crossed", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 }); // rotate after the very first entry
    const e1 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "seg1" },
    });
    const e2 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "seg2" },
    });

    const indexes = await listSegmentIndexes(config.fs, config.segmentsDir);
    expect(indexes).toEqual([FIRST_SEQ, FIRST_SEQ + 1]);
    // The chain still continues correctly across the rotation boundary.
    expect(e2.prevHash).toBe(e1.hash);
    expect(e2.seq).toBe(e1.seq + 1);
  });

  it("rotates to a new segment once the age threshold is crossed", async () => {
    // birthtimeMs comes from the REAL filesystem (the segment file's actual
    // creation time), so the injected clock must stay anchored to real
    // wall-clock time — an arbitrary fixed-epoch clock (e.g. year 2026)
    // would drift arbitrarily far from the real birthtime and either always
    // or never cross the threshold regardless of the real elapsed gap.
    const base = Date.now();
    let tick = 0;
    const clock = () => {
      const iso = new Date(base + tick * 3_600_000).toISOString(); // +1h per call
      tick += 1;
      return iso;
    };
    const config = freshConfig({ clock, segmentMaxAgeMs: 1000 });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "old" } });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "new" } });
    const indexes = await listSegmentIndexes(config.fs, config.segmentsDir);
    expect(indexes.length).toBeGreaterThanOrEqual(2);
  });

  it("carries the optional runId/changeSetId/workUnitId correlation fields when supplied", async () => {
    const config = freshConfig();
    const entry = await appendEntry(config, {
      type: "work_unit_transition",
      payload: { status: "pending" },
      runId: "11111111-1111-4111-8111-111111111111",
      workUnitId: "22222222-2222-4222-8222-222222222222",
    });
    expect(entry.runId).toBe("11111111-1111-4111-8111-111111111111");
    expect(entry.workUnitId).toBe("22222222-2222-4222-8222-222222222222");
    expect(entry.changeSetId).toBeUndefined();
  });

  it("refuses to append onto a segment whose tail is corrupted (readLastEntry surfaces JournalCorruptedTailError)", async () => {
    const config = freshConfig();
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "ok" } });
    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    writeFileSync(path, `${readFileSync(path, "utf8")}{"truncated": tr`);

    await expect(
      appendEntry(config, { type: "fanout_rationale", payload: { rationale: "next" } }),
    ).rejects.toThrow(JournalCorruptedTailError);
  });

  it("readLastEntry returns undefined for a segment with no entries yet (file doesn't exist)", async () => {
    const config = freshConfig();
    const result = await readLastEntry(config, FIRST_SEQ);
    expect(result).toBeUndefined();
  });

  it("readLastEntry returns undefined for a segment file that exists but has zero lines", async () => {
    const config = freshConfig();
    mkdirSync(config.segmentsDir, { recursive: true });
    writeFileSync(segmentPath(config.segmentsDir, FIRST_SEQ), "");
    const result = await readLastEntry(config, FIRST_SEQ);
    expect(result).toBeUndefined();
  });
});

describe("appendEntry — p50 latency (documented measurement)", () => {
  it("appends 100 sequential entries and reports p50 latency under a generous bound", async () => {
    const config = freshConfig();
    const durationsMs: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = performance.now();

      await appendEntry(config, { type: "fanout_rationale", payload: { rationale: `entry-${i}` } });
      durationsMs.push(performance.now() - start);
    }
    const sorted = [...durationsMs].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)]!;
    // Documented measurement (roadmap/04 work item 2: "measure p50 append
    // latency"; exit criterion: "Append p50 latency documented with a CI
    // regression gate"). Reported via a test annotation rather than
    // console.log (house style forbids console output in this package).
    expect(
      p50,
      `appendEntry p50 latency over 100 real-fs appends: ${p50.toFixed(3)}ms`,
    ).toBeLessThan(200);
  });
});
