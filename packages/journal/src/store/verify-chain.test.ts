import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeEntryHash, GENESIS_PREV_HASH } from "../codec/hash-chain.js";
import { FIRST_SEQ } from "../codec/journal-entry.js";
import { appendEntry } from "./append-entry.js";
import { segmentPath } from "./segment-layout.js";
import { resolveStoreConfig, type JournalStoreConfig } from "./store-config.js";
import { verifyChain } from "./verify-chain.js";

let journalDir: string | undefined;

function freshConfig(): JournalStoreConfig {
  journalDir = mkdtempSync(join(tmpdir(), "eo-journal-verify-"));
  return resolveStoreConfig({ journalDir });
}

afterEach(() => {
  if (journalDir !== undefined) rmSync(journalDir, { recursive: true, force: true });
  journalDir = undefined;
});

describe("verifyChain — empty / trivial segments", () => {
  it("reports no issue and zero entries for a segment that doesn't exist yet", async () => {
    const config = freshConfig();
    const report = await verifyChain(config.fs, segmentPath(config.segmentsDir, FIRST_SEQ));
    expect(report.firstIssue).toBeUndefined();
    expect(report.validEntries).toEqual([]);
    expect(report.totalLines).toBe(0);
  });

  it("reports no issue and zero entries for a segment file that exists but is empty (0 bytes)", async () => {
    const config = freshConfig();
    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    mkdirSync(config.segmentsDir, { recursive: true });
    writeFileSync(path, "");
    const report = await verifyChain(config.fs, path);
    expect(report.firstIssue).toBeUndefined();
    expect(report.validEntries).toEqual([]);
    expect(report.totalLines).toBe(0);
  });
});

describe("verifyChain — a blank line embedded mid-file is its own corruption kind", () => {
  it("reports a parse_error at the blank line, distinct from a torn tail", async () => {
    const config = freshConfig();
    const e1 = await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "a" } });
    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    writeFileSync(path, `${readFileSync(path, "utf8")}\nnot-empty-but-invalid\n`);

    const report = await verifyChain(config.fs, path);
    expect(report.firstIssue?.kind).toBe("parse_error");
    expect(report.firstIssue?.detail).toContain("empty line");
    expect(report.validEntries).toEqual([e1]);
  });
});

describe("verifyChain — seq_gap detection", () => {
  it("reports seq_gap when a hand-crafted entry skips a sequence number", async () => {
    const config = freshConfig();
    const e1 = await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "a" } });
    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const draft = {
      schemaVersion: 1,
      seq: e1.seq + 5, // skips ahead
      type: "fanout_rationale" as const,
      payload: { rationale: "gap" },
      prevHash: e1.hash,
      timestamp: "2026-01-01T00:00:01.000Z",
    };
    const hash = computeEntryHash(draft);
    writeFileSync(path, `${readFileSync(path, "utf8")}${JSON.stringify({ ...draft, hash })}\n`);

    const report = await verifyChain(config.fs, path);
    expect(report.firstIssue?.kind).toBe("seq_gap");
    expect(report.validEntries).toEqual([e1]);
  });
});

describe("verifyChain — a fully valid chain", () => {
  it("reports no issue and every entry as valid", async () => {
    const config = freshConfig();
    const e1 = await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "a" } });
    const e2 = await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "b" } });
    const e3 = await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "c" } });

    const report = await verifyChain(config.fs, segmentPath(config.segmentsDir, FIRST_SEQ));
    expect(report.firstIssue).toBeUndefined();
    expect(report.validEntries).toEqual([e1, e2, e3]);
    expect(report.truncatedTrailingBytes).toBe(0);
  });
});

describe("verifyChain — corrupted-tail fixture (valid chain truncated mid-entry)", () => {
  it("detects the torn tail: all prior entries stay valid, the torn line is reported as the first issue", async () => {
    const config = freshConfig();
    const e1 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "kept-1" },
    });
    const e2 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "kept-2" },
    });
    await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "this-one-gets-torn" },
    });

    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const full = readFileSync(path, "utf8");
    // Simulate a crash mid-write: cut the file strictly inside the LAST
    // line's bytes (never at a line boundary), so entries 1-2 stay fully
    // intact and only the tail entry is torn.
    const lastNewline = full.lastIndexOf("\n", full.length - 2);
    const tornAt = lastNewline + 1 + Math.floor((full.length - (lastNewline + 1)) / 2);
    writeFileSync(path, full.slice(0, tornAt));

    const report = await verifyChain(config.fs, path);
    expect(report.firstIssue).toBeDefined();
    expect(report.firstIssue?.kind).toBe("parse_error");
    expect(report.validEntries).toEqual([e1, e2]);
    expect(report.truncatedTrailingBytes).toBeGreaterThan(0);
    // entries 1-2 fully occupy the bytes up to (and including) the newline
    // right before the torn third line — exactly `lastNewline + 1`.
    expect(report.lastValidByteLength).toBe(lastNewline + 1);
    expect(report.lastValidByteLength + report.truncatedTrailingBytes).toBe(tornAt);
  });
});

describe("verifyChain — security: post-hoc single-byte tamper of a HISTORICAL entry", () => {
  it("fails verification when an EARLIER entry (not the tail) is byte-tampered, distinctly from a torn tail", async () => {
    const config = freshConfig();
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "AAAAAAAAAA" } });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "second" } });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "third" } });

    const path = segmentPath(config.segmentsDir, FIRST_SEQ);
    const full = readFileSync(path, "utf8");
    // Flip exactly one byte inside the FIRST entry's payload text — the file
    // length is unchanged, so this is a substitution, not a truncation.
    const target = full.indexOf("AAAAAAAAAA");
    const tampered = `${full.slice(0, target)}B${full.slice(target + 1)}`;
    expect(tampered.length).toBe(full.length);
    writeFileSync(path, tampered);

    const report = await verifyChain(config.fs, path);
    expect(report.firstIssue).toBeDefined();
    expect(report.firstIssue?.kind).toBe("hash_mismatch");
    expect(report.firstIssue?.lineIndex).toBe(0);
    // Distinct from the torn-tail case: this is a hash_mismatch, not a parse_error.
    expect(report.firstIssue?.kind).not.toBe("parse_error");
  });
});

describe("verifyChain — prevHash chaining across an explicit initial prevHash", () => {
  it("accepts a non-genesis expectedInitialPrevHash for a would-be second segment", async () => {
    const config = freshConfig();
    // Hand-build a single-entry segment whose prevHash is some other segment's last hash.
    const priorHash = "1".repeat(64);
    const draft = {
      schemaVersion: 1,
      seq: 50,
      type: "fanout_rationale" as const,
      payload: { rationale: "continuation" },
      prevHash: priorHash,
      timestamp: "2026-01-01T00:00:00.000Z",
    };
    const { computeEntryHash } = await import("../codec/hash-chain.js");
    const hash = computeEntryHash(draft);
    const line = `${JSON.stringify({ ...draft, hash })}\n`;
    const path = join(journalDir!, "manual-segment.ndjson");
    writeFileSync(path, line);

    const reportWithWrongExpectation = await verifyChain(config.fs, path, GENESIS_PREV_HASH);
    expect(reportWithWrongExpectation.firstIssue?.kind).toBe("prev_hash_mismatch");

    const reportWithCorrectExpectation = await verifyChain(config.fs, path, priorHash);
    expect(reportWithCorrectExpectation.firstIssue).toBeUndefined();
  });
});
