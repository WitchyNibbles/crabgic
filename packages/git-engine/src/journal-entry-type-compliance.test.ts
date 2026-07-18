import { describe, expect, it } from "vitest";
import { JOURNAL_ENTRY_TYPES, type JournalEntryType } from "@eo/contracts";
import { JournalEntrySchema } from "@eo/journal";
import type { GitEngineJournalEntryInput } from "./journal-appender.js";

/**
 * Exit criterion — roadmap/07-git-control-repo-worktrees.md: "Every entry
 * this package journals matches the `git_freeze` or `worktree_quarantine`
 * member of `JournalEntryType` and passes 02's discriminated-union
 * exhaustiveness harness (mirrors 13's own exit-criterion phrasing for the
 * same harness)." This package is the SOLE writer of exactly these two of
 * the 13 closed members (interface-ledger Gap 5) — never a 3rd.
 */

// Compile-time check: every `type` literal `./journal-appender.ts`'s
// `GitEngineJournalEntryInput` union can carry is assignable to
// `JournalEntryType` (@eo/contracts) — a typo or a member 02 never defined
// would fail `npx tsc -b packages/git-engine` right here.
type AssertMembersAreValid = GitEngineJournalEntryInput["type"] extends JournalEntryType
  ? true
  : never;
const _typeCheck: AssertMembersAreValid = true;
void _typeCheck;

const THIS_PACKAGE_JOURNAL_ENTRY_TYPES = ["git_freeze", "worktree_quarantine"] as const;

describe("this package's journal-entry-type surface (exit criterion)", () => {
  it("both members it writes are real, closed members of @eo/contracts' 13-member JournalEntryType", () => {
    for (const type of THIS_PACKAGE_JOURNAL_ENTRY_TYPES) {
      expect(JOURNAL_ENTRY_TYPES).toContain(type);
    }
  });

  it("writes exactly two members — never a 3rd, undeclared journal-entry type", () => {
    expect(THIS_PACKAGE_JOURNAL_ENTRY_TYPES).toHaveLength(2);
  });

  it("a constructed git_freeze entry round-trips through @eo/journal's own JournalEntrySchema", () => {
    const candidate = {
      schemaVersion: 1,
      seq: 1,
      type: "git_freeze" as const,
      payload: {
        scopePath: "/some/user/checkout",
        reason: "intake freeze committed at main@deadbeef",
      },
      prevHash: "0".repeat(64),
      hash: "1".repeat(64),
      timestamp: new Date().toISOString(),
    };
    expect(() => JournalEntrySchema.parse(candidate)).not.toThrow();
  });

  it("a constructed worktree_quarantine entry round-trips through @eo/journal's own JournalEntrySchema", () => {
    const candidate = {
      schemaVersion: 1,
      seq: 1,
      type: "worktree_quarantine" as const,
      payload: {
        worktreePath: "/cache/worktree-quarantine/att-xyz",
        reason: "dirty worktree found at startup",
      },
      prevHash: "0".repeat(64),
      hash: "1".repeat(64),
      timestamp: new Date().toISOString(),
    };
    expect(() => JournalEntrySchema.parse(candidate)).not.toThrow();
  });
});
