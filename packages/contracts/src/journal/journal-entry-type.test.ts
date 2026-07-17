import { describe, expect, it } from "vitest";
import {
  JOURNAL_ENTRY_TYPE_DESCRIPTIONS,
  JOURNAL_ENTRY_TYPES,
  JournalEntryTypeSchema,
} from "./journal-entry-type.js";

/**
 * `JournalEntryType` unit tests (roadmap/02 work item 5; interface-ledger
 * Gap 5). The exhaustiveness/`tsc -b` demonstration itself is NOT encoded
 * as a permanent test here — it was performed once, out of band, by
 * temporarily adding a 14th stubbed member to this file, running
 * `npx tsc -b packages/contracts` to capture the real failing output, then
 * removing the stub and capturing the clean build. See
 * `docs/evidence/phase-02/wi5-journal-14th-member-tsc-failing.txt` and
 * `docs/evidence/phase-02/wi5-journal-tsc-clean.txt`.
 */
describe("JournalEntryType", () => {
  it("has exactly 13 members (interface-ledger Gap 5)", () => {
    expect(JOURNAL_ENTRY_TYPES.length).toBe(13);
  });

  it("accepts every declared member", () => {
    for (const entryType of JOURNAL_ENTRY_TYPES) {
      expect(JournalEntryTypeSchema.safeParse(entryType).success).toBe(true);
    }
  });

  it("rejects a member outside the closed union", () => {
    expect(JournalEntryTypeSchema.safeParse("rate_limit_park").success).toBe(false);
  });

  it("rejects the empty string and non-string values", () => {
    expect(JournalEntryTypeSchema.safeParse("").success).toBe(false);
    expect(JournalEntryTypeSchema.safeParse(42).success).toBe(false);
    expect(JournalEntryTypeSchema.safeParse(null).success).toBe(false);
    expect(JournalEntryTypeSchema.safeParse(undefined).success).toBe(false);
  });

  it("matches the binding 13-member list verbatim, in order (interface-ledger Gap 5)", () => {
    expect(JOURNAL_ENTRY_TYPES).toEqual([
      "run_transition",
      "work_unit_transition",
      "adjudication_decision",
      "remote_operation_record",
      "evidence_pointer",
      "session_assignment",
      "git_freeze",
      "worktree_quarantine",
      "cas_ref_update",
      "approval_token_mint",
      "fanout_rationale",
      "milestone_sync",
      "learning_transition",
    ]);
  });

  it("has no separate rate_limit_park member (rate-limit parks are work_unit_transition entries)", () => {
    expect(JOURNAL_ENTRY_TYPES).not.toContain("rate_limit_park");
  });

  it("the exhaustiveness descriptor covers exactly the 13 declared members, one description each", () => {
    const descriptorKeys = Object.keys(JOURNAL_ENTRY_TYPE_DESCRIPTIONS).sort();
    const memberKeys = [...JOURNAL_ENTRY_TYPES].sort();
    expect(descriptorKeys).toEqual(memberKeys);
    for (const entryType of JOURNAL_ENTRY_TYPES) {
      expect(typeof JOURNAL_ENTRY_TYPE_DESCRIPTIONS[entryType]).toBe("string");
      expect(JOURNAL_ENTRY_TYPE_DESCRIPTIONS[entryType].length).toBeGreaterThan(0);
    }
  });
});
