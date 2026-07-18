import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GENESIS_PREV_HASH } from "../codec/hash-chain.js";
import { FIRST_SEQ } from "../codec/journal-entry.js";
import { appendEntry } from "./append-entry.js";
import { repairChain } from "./repair-chain.js";
import { segmentPath } from "./segment-layout.js";
import { resolveStoreConfig, type JournalStoreConfig } from "./store-config.js";
import { verifyChain } from "./verify-chain.js";

let journalDir: string | undefined;

function freshConfig(): JournalStoreConfig {
  journalDir = mkdtempSync(join(tmpdir(), "eo-journal-repair-"));
  return resolveStoreConfig({ journalDir });
}

afterEach(() => {
  if (journalDir !== undefined) rmSync(journalDir, { recursive: true, force: true });
  journalDir = undefined;
});

describe("repairChain", () => {
  it("is a no-op on an already-fully-valid segment", async () => {
    const config = freshConfig();
    const e1 = await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "a" } });
    const path = segmentPath(config.segmentsDir, FIRST_SEQ);

    const report = await repairChain(config, path);
    expect(report.repaired).toBe(false);
    expect(report.truncatedToSeq).toBe(e1.seq);
    expect(report.repairEntrySeq).toBeUndefined();
  });

  it("is a no-op on an empty-but-valid segment (zero entries, no issue) — truncatedToSeq stays absent", async () => {
    const config = freshConfig();
    mkdirSync(config.segmentsDir, { recursive: true });
    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    writeFileSync(path, "");

    const report = await repairChain(config, path);
    expect(report.repaired).toBe(false);
    expect(report.truncatedToSeq).toBeUndefined();
  });

  it("truncates a torn tail and appends an adjudication_decision repair entry chained onto the last valid entry", async () => {
    const config = freshConfig();
    const e1 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "kept-1" },
    });
    const e2 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "kept-2" },
    });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "torn" } });

    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const full = readFileSync(path, "utf8");
    const lastNewline = full.lastIndexOf("\n", full.length - 2);
    writeFileSync(path, full.slice(0, lastNewline + 1 + 5));

    const report = await repairChain(config, path);
    expect(report.repaired).toBe(true);
    expect(report.discardedLineCount).toBe(1);
    expect(report.discardedByteLength).toBeGreaterThan(0);
    expect(report.truncatedToSeq).toBe(e2.seq);
    expect(report.repairEntrySeq).toBe(e2.seq + 1);

    // The segment now re-verifies as a fully valid chain (repair entry included).
    const reverified = await verifyChain(config.fs, path);
    expect(reverified.firstIssue).toBeUndefined();
    expect(reverified.validEntries).toHaveLength(3);
    expect(reverified.validEntries[0]).toEqual(e1);
    expect(reverified.validEntries[1]).toEqual(e2);
    expect(reverified.validEntries[2]!.type).toBe("adjudication_decision");
    if (reverified.validEntries[2]!.type !== "adjudication_decision")
      throw new Error("unreachable");
    expect(reverified.validEntries[2]!.payload.decision).toBe("chain_tail_truncated");
  });

  it("truncates a segment that is corrupt from its very first line (zero valid entries) and starts the chain fresh", async () => {
    const config = freshConfig();
    mkdirSync(config.segmentsDir, { recursive: true });
    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    writeFileSync(path, "{not even valid json");

    const report = await repairChain(config, path);
    expect(report.repaired).toBe(true);
    expect(report.truncatedToSeq).toBeUndefined();
    expect(report.repairEntrySeq).toBe(FIRST_SEQ);

    const reverified = await verifyChain(config.fs, path);
    expect(reverified.firstIssue).toBeUndefined();
    expect(reverified.validEntries).toHaveLength(1);
    expect(reverified.validEntries[0]!.seq).toBe(FIRST_SEQ);
    expect(reverified.validEntries[0]!.prevHash).toBe(GENESIS_PREV_HASH);
  });

  it("the repair entry is durably persisted (readable back from a fresh read of the file)", async () => {
    const config = freshConfig();
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "kept" } });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "torn" } });
    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const full = readFileSync(path, "utf8");
    const lastNewline = full.lastIndexOf("\n", full.length - 2);
    writeFileSync(path, full.slice(0, lastNewline + 1 + 3));

    await repairChain(config, path);
    const finalContent = readFileSync(path, "utf8");
    const lines = finalContent.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).type).toBe("adjudication_decision");
  });
});
