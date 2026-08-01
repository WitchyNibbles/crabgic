import { describe, expect, it } from "vitest";
import { createJournalWriterSeparationCheck } from "./journal-writer-separation.js";

const JOURNAL_DIR = "/state/crabgic/abc123/journal";

function check(stat: { uid: number; mode: number } | undefined, currentUid = 1000) {
  return createJournalWriterSeparationCheck({
    journalDir: JOURNAL_DIR,
    currentUid,
    statPath: () => stat,
  }).run();
}

describe("journal.writer-separation doctor check", () => {
  it("passes quietly when there is no journal directory yet", async () => {
    const finding = await check(undefined);
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("nothing to separate");
  });

  it("FAILS on a group- or world-writable journal — wrong under every model", async () => {
    const finding = await check({ uid: 1000, mode: 0o770 });
    expect(finding.passed).toBe(false);
    expect(finding.evidence).toContain("group- or world-writable");
    expect(finding.repairStep).toContain("chmod 700");
  });

  it("FAILS on a world-writable journal", async () => {
    const finding = await check({ uid: 1000, mode: 0o707 });
    expect(finding.passed).toBe(false);
  });

  /**
   * Deliberately a PASS with an advisory, not a failure. Single-uid is the
   * supported default; failing it every run on every developer machine would
   * train operators to ignore this check, which is worse than not having it.
   * The evidence still says plainly that there is no separation.
   */
  it("passes but reports the absence of separation when the journal is owned by this uid", async () => {
    const finding = await check({ uid: 1000, mode: 0o700 }, 1000);
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("no writer separation");
    expect(finding.evidence).toContain("workers included");
  });

  it("reports separation IS in effect when the journal is owned by another uid", async () => {
    const finding = await check({ uid: 900, mode: 0o700 }, 1000);
    expect(finding.passed).toBe(true);
    expect(finding.evidence).toContain("writer separation in effect");
    expect(finding.evidence).toContain("900");
  });

  it("is a warning, never an error — it describes posture, it does not block", () => {
    const created = createJournalWriterSeparationCheck({ journalDir: JOURNAL_DIR });
    expect(created.severity).toBe("warning");
    expect(created.id).toBe("journal.writer-separation");
  });
});
