import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendEntry } from "./append-entry.js";
import { JournalTamperedError, repairJournal } from "./repair-journal.js";
import { segmentPath } from "./segment-layout.js";
import { resolveStoreConfig, type JournalStoreConfig } from "./store-config.js";
import { verifyJournal } from "./verify-journal.js";

/**
 * VALIDATION ROUND (2026-07-18) fix, MAJOR 1: `repairJournal` is the safe,
 * whole-journal repair surface that replaces the store's prior
 * `repairChain(segmentFilePath, expectedInitialPrevHash = GENESIS)`
 * convenience method (removed — see `journal-store.ts`'s own file-level
 * doc comment). Top-level regression evidence:
 * `../../../docs/evidence/phase-04/fix1-rotated-repair-{failing,
 * passing}.txt`. This file covers the module's own unit-level behavior.
 */

let journalDir: string | undefined;

function freshConfig(
  overrides: Partial<Parameters<typeof resolveStoreConfig>[0]> = {},
): JournalStoreConfig {
  journalDir = mkdtempSync(join(tmpdir(), "eo-journal-repair-journal-"));
  return resolveStoreConfig({ journalDir, ...overrides });
}

afterEach(() => {
  if (journalDir !== undefined) rmSync(journalDir, { recursive: true, force: true });
  journalDir = undefined;
});

describe("repairJournal — no-op on an already fully valid, rotated journal", () => {
  it("does not touch anything and reports repaired=false", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 });
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

    const report = await repairJournal(config);
    expect(report.repaired).toBe(false);
    expect(report.verification.valid).toBe(true);
    expect(report.verification.totalValidEntries).toBe(3);
    expect(report.verification.lastValidEntry).toEqual(e3);

    // Nothing was rewritten.
    expect(JSON.parse(readFileSync(segmentPath(config.segmentsDir, 1), "utf8").trim())).toEqual(e1);
    expect(JSON.parse(readFileSync(segmentPath(config.segmentsDir, 2), "utf8").trim())).toEqual(e2);
    expect(JSON.parse(readFileSync(segmentPath(config.segmentsDir, 3), "utf8").trim())).toEqual(e3);
  });
});

describe("VALIDATION ROUND (2026-07-18) — MAJOR 1: seq continuity across a genuine tail repair spanning a rotation boundary", () => {
  it("repairs a torn write in the LAST of 3 segments and the repair entry's seq continues from the true cross-segment last valid entry (no duplicate/reset to 1)", async () => {
    const config = freshConfig({ segmentMaxBytes: 1 });
    const e1 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "s1" },
    });
    const e2 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "s2" },
    });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "s3-torn" } });

    // Tear segment 3's only entry down to zero valid bytes (the exact
    // MAJOR 1 symptom: the highest segment ends up holding ZERO valid
    // entries after truncation).
    const path3 = segmentPath(config.segmentsDir, 3);
    writeFileSync(path3, readFileSync(path3, "utf8").slice(0, 5));

    const report = await repairJournal(config);
    expect(report.repaired).toBe(true);
    expect(report.segmentRepair?.segmentFilePath).toBe(path3);
    expect(report.verification.valid).toBe(true);

    // The repair entry (adjudication_decision) must continue seq from e2
    // (the true last valid entry ACROSS segments), never reset to 1.
    const repairEntry = report.verification.lastValidEntry;
    expect(repairEntry?.type).toBe("adjudication_decision");
    expect(repairEntry?.seq).toBe(e2.seq + 1);
    expect(repairEntry?.prevHash).toBe(e2.hash);

    // Global seq set has no duplicates.
    const allSeqs = report.verification.segments.flatMap((s) =>
      s.report.validEntries.map((e) => e.seq),
    );
    expect(new Set(allSeqs).size).toBe(allSeqs.length);
    expect(allSeqs).toEqual([e1.seq, e2.seq, e2.seq + 1]);
  });
});

describe("VALIDATION ROUND (2026-07-18) — MAJOR 1: repairJournal REFUSES on mid-journal (historical) tamper", () => {
  it("throws JournalTamperedError instead of truncating away real, still-present later entries", async () => {
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

    const path1 = segmentPath(config.segmentsDir, 1);
    const full1 = readFileSync(path1, "utf8");
    const target = full1.indexOf("AAAAAAAAAA");
    writeFileSync(path1, `${full1.slice(0, target)}B${full1.slice(target + 1)}`);

    await expect(repairJournal(config)).rejects.toThrow(JournalTamperedError);
    await expect(repairJournal(config)).rejects.toMatchObject({
      segmentIndex: 1,
      issueKind: "hash_mismatch",
    });

    // Nothing was truncated — e2/e3 survive untouched on disk.
    const afterVerify = await verifyJournal(config);
    expect(afterVerify.valid).toBe(false); // still tampered — refusing means NOT fixed, by design
    expect(readFileSync(segmentPath(config.segmentsDir, 2), "utf8")).toContain(e2.hash);
    expect(readFileSync(segmentPath(config.segmentsDir, 3), "utf8")).toContain(e3.hash);
  });
});

describe("repairJournal — parity with the old single-segment repairChain behavior for an unrotated journal", () => {
  it("repairs a torn tail on a single-segment journal identically to the pre-fix repairChain call shape", async () => {
    const config = freshConfig();
    const e1 = await appendEntry(config, {
      type: "fanout_rationale",
      payload: { rationale: "kept" },
    });
    await appendEntry(config, { type: "fanout_rationale", payload: { rationale: "torn" } });
    const path = segmentPath(config.segmentsDir, 1);
    const full = readFileSync(path, "utf8");
    const lastNewline = full.lastIndexOf("\n", full.length - 2);
    writeFileSync(path, full.slice(0, lastNewline + 1 + 3));

    const report = await repairJournal(config);
    expect(report.repaired).toBe(true);
    expect(report.segmentRepair?.truncatedToSeq).toBe(e1.seq);
    expect(report.segmentRepair?.repairEntrySeq).toBe(e1.seq + 1);
    expect(report.verification.valid).toBe(true);
  });
});
