import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeFsPort } from "./fs-port.js";
import {
  listSegmentIndexes,
  segmentFileName,
  segmentIndexFromFileName,
  segmentPath,
  shouldRotateSegment,
} from "./segment-layout.js";

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("segment file naming", () => {
  it("segmentFileName zero-pads the index and segmentIndexFromFileName inverts it", () => {
    expect(segmentFileName(1)).toBe("segment-00000001.ndjson");
    expect(segmentIndexFromFileName("segment-00000001.ndjson")).toBe(1);
    expect(segmentIndexFromFileName(segmentFileName(42))).toBe(42);
  });

  it("segmentIndexFromFileName returns undefined for non-segment names", () => {
    expect(segmentIndexFromFileName("snapshot-abc.json")).toBeUndefined();
    expect(segmentIndexFromFileName("segment-notanumber.ndjson")).toBeUndefined();
    expect(segmentIndexFromFileName("random.txt")).toBeUndefined();
  });

  it("segmentPath joins the segments dir with the segment file name", () => {
    expect(segmentPath("/journal/segments", 3)).toBe("/journal/segments/segment-00000003.ndjson");
  });
});

describe("listSegmentIndexes — real filesystem", () => {
  it("returns [] for a nonexistent directory", async () => {
    dir = mkdtempSync(join(tmpdir(), "eo-journal-seg-"));
    const missing = join(dir, "does-not-exist");
    expect(await listSegmentIndexes(createNodeFsPort(), missing)).toEqual([]);
  });

  it("returns segment indexes in ascending order, ignoring non-segment files", async () => {
    dir = mkdtempSync(join(tmpdir(), "eo-journal-seg-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "segment-00000003.ndjson"), "");
    writeFileSync(join(dir, "segment-00000001.ndjson"), "");
    writeFileSync(join(dir, "segment-00000002.ndjson"), "");
    writeFileSync(join(dir, "not-a-segment.txt"), "");
    expect(await listSegmentIndexes(createNodeFsPort(), dir)).toEqual([1, 2, 3]);
  });
});

describe("shouldRotateSegment", () => {
  it("rotates once size crosses maxBytes", () => {
    expect(shouldRotateSegment({ size: 100, birthtimeMs: 0 }, 0, 100, 1_000_000)).toBe(true);
    expect(shouldRotateSegment({ size: 99, birthtimeMs: 0 }, 0, 100, 1_000_000)).toBe(false);
  });

  it("rotates once age crosses maxAgeMs", () => {
    expect(shouldRotateSegment({ size: 0, birthtimeMs: 0 }, 1000, 1_000_000, 1000)).toBe(true);
    expect(shouldRotateSegment({ size: 0, birthtimeMs: 0 }, 999, 1_000_000, 1000)).toBe(false);
  });
});
