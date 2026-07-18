import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendEntry } from "./append-entry.js";
import { segmentPath } from "./segment-layout.js";
import { resolveStoreConfig, type JournalStoreConfig } from "./store-config.js";
import { verifyJournal } from "./verify-journal.js";

/**
 * VALIDATION ROUND (2026-07-18) fix, MAJOR 1: `verifyJournal` is the
 * whole-journal orchestration layer that never existed before this fix —
 * `verifyChain` alone only ever verified one segment in isolation. See
 * `../../../docs/evidence/phase-04/fix1-rotated-repair-{failing,
 * passing}.txt` for the top-level regression evidence; this file covers
 * the module's own unit-level behavior directly.
 */

let journalDir: string | undefined;

function freshConfig(
  overrides: Partial<Parameters<typeof resolveStoreConfig>[0]> = {},
): JournalStoreConfig {
  journalDir = mkdtempSync(join(tmpdir(), "eo-journal-verify-journal-"));
  return resolveStoreConfig({ journalDir, ...overrides });
}

afterEach(() => {
  if (journalDir !== undefined) rmSync(journalDir, { recursive: true, force: true });
  journalDir = undefined;
});

describe("verifyJournal — empty journal", () => {
  it("reports valid=true, zero segments, for a directory with no segments yet", async () => {
    const config = freshConfig();
    const report = await verifyJournal(config);
    expect(report.valid).toBe(true);
    expect(report.segments).toEqual([]);
    expect(report.firstInvalid).toBeUndefined();
    expect(report.lastValidEntry).toBeUndefined();
    expect(report.totalValidEntries).toBe(0);
  });
});

describe("verifyJournal — threading across a rotated, fully valid journal", () => {
  it("threads prevHash AND seq across every segment boundary, reporting the whole journal valid", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 }); // rotate after every entry
    const e1 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "s1" },
    });
    const e2 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "s2" },
    });
    const e3 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "s3" },
    });

    const report = await verifyJournal(config);
    expect(report.valid).toBe(true);
    expect(report.firstInvalid).toBeUndefined();
    expect(report.totalValidEntries).toBe(3);
    expect(report.lastValidEntry).toEqual(e3);
    expect(report.segments.map((s) => s.report.validEntries)).toEqual([[e1], [e2], [e3]]);
  });
});

describe("verifyJournal — tail-position torn write (safe to repair)", () => {
  it("reports isTailPosition=true when nothing decodable exists anywhere after the torn point", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 });
    const e1 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "s1" },
    });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "s2-torn" } });

    const path = segmentPath(config.segmentsDir, 2);
    const full = readFileSync(path, "utf8");
    const lastNewline = full.lastIndexOf("\n", full.length - 2);
    writeFileSync(path, full.slice(0, lastNewline + 1 + 3)); // torn mid-line

    const report = await verifyJournal(config);
    expect(report.valid).toBe(false);
    expect(report.firstInvalid?.segmentIndex).toBe(2);
    expect(report.firstInvalid?.isTailPosition).toBe(true);
    expect(report.lastValidEntry).toEqual(e1);
    expect(report.totalValidEntries).toBe(1);
  });
});

describe("VALIDATION ROUND (2026-07-18) — MAJOR 1: mid-journal (historical) tamper detection", () => {
  it("reports isTailPosition=false when a LATER segment still holds decodable entries past the corrupted point", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "AAAAAAAAAA" } });
    const e2 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "s2" },
    });
    const e3 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "s3" },
    });

    // Post-hoc single-byte tamper of segment 1's entry — file length
    // unchanged, so this is a substitution, not a truncation (roadmap/04's
    // own security-plan tamper repro, applied here at the WHOLE-JOURNAL
    // level rather than per-segment).
    const path1 = segmentPath(config.segmentsDir, 1);
    const full1 = readFileSync(path1, "utf8");
    const target = full1.indexOf("AAAAAAAAAA");
    const tampered = `${full1.slice(0, target)}B${full1.slice(target + 1)}`;
    expect(tampered.length).toBe(full1.length);
    writeFileSync(path1, tampered);

    const report = await verifyJournal(config);
    expect(report.valid).toBe(false);
    expect(report.firstInvalid?.segmentIndex).toBe(1);
    expect(report.firstInvalid?.issue.kind).toBe("hash_mismatch");
    expect(report.firstInvalid?.isTailPosition).toBe(false);
    expect(report.totalValidEntries).toBe(0);

    // e2/e3 still physically exist on disk, untouched by verification —
    // this is exactly why blind truncation would be catastrophic here.
    expect(readFileSync(segmentPath(config.segmentsDir, 2), "utf8")).toContain(e2.hash);
    expect(readFileSync(segmentPath(config.segmentsDir, 3), "utf8")).toContain(e3.hash);
  });

  it("also detects tamper within the SAME segment (decodable lines after the tampered one, same file)", async () => {
    const config = freshConfig(); // single segment, no rotation
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "AAAAAAAAAA" } });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "second" } });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "third" } });

    const path = segmentPath(config.segmentsDir, 1);
    const full = readFileSync(path, "utf8");
    const target = full.indexOf("AAAAAAAAAA");
    writeFileSync(path, `${full.slice(0, target)}B${full.slice(target + 1)}`);

    const report = await verifyJournal(config);
    expect(report.firstInvalid?.isTailPosition).toBe(false);
  });
});

describe("verifyJournal — cross-segment seq continuity", () => {
  it("detects a duplicate/skipped seq exactly at a segment boundary via expectedInitialSeq threading", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 });
    const e1 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "s1" },
    });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "s2" } });

    // Hand-craft segment 2's entry with a WRONG seq (duplicate of e1's) —
    // simulating exactly the MAJOR 1 defect's own observable symptom
    // (a repair producing a duplicate seq=1 entry in a later segment).
    const { computeEntryHash } = await import("../codec/hash-chain.js");
    const draft = {
      schemaVersion: 1,
      seq: e1.seq, // duplicate!
      type: "fanout_rationale" as const,
      payload: { rationale: "duplicate-seq" },
      prevHash: e1.hash,
      timestamp: "2026-01-01T00:00:01.000Z",
    };
    const hash = computeEntryHash(draft);
    writeFileSync(segmentPath(config.segmentsDir, 2), `${JSON.stringify({ ...draft, hash })}\n`);

    const report = await verifyJournal(config);
    expect(report.valid).toBe(false);
    expect(report.firstInvalid?.segmentIndex).toBe(2);
    expect(report.firstInvalid?.issue.kind).toBe("seq_gap");
    expect(report.totalValidEntries).toBe(1);
  });
});
