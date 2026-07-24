import { describe, expect, it } from "vitest";
import { JOURNAL_ENTRY_TYPES, type JournalEntryType } from "@eo/contracts";
import { JournalEntrySchema } from "@eo/journal";
import {
  INTEGRATION_JOURNAL_ENTRY_TYPES,
  type IntegrationJournalEntryType,
} from "./integration-journal.js";

/**
 * Exit criterion (mirroring 07's own `journal-entry-type-compliance.test.ts`
 * for its two members) — roadmap/08-integration-publication.md §Interfaces
 * consumed: "the `cas_ref_update` and `evidence_pointer` members." This
 * phase is the SOLE writer of exactly these two of the 13 closed
 * `JournalEntryType` members among what this package (`packages/git-engine`)
 * writes — never a 3rd, and never one of 07's own two (`git_freeze`/
 * `worktree_quarantine`).
 */

// Compile-time check: every `type` literal `./integration-journal.ts`'s
// `IntegrationJournalEntryType` union can carry is assignable to
// `JournalEntryType` (@eo/contracts) — a typo or a member 02 never defined
// would fail `npx tsc -b packages/git-engine` right here.
type AssertMembersAreValid = IntegrationJournalEntryType extends JournalEntryType ? true : never;
const _typeCheck: AssertMembersAreValid = true;
void _typeCheck;

describe("this phase's own journal-entry-type surface (exit criterion)", () => {
  it("both members it writes are real, closed members of @eo/contracts' 13-member JournalEntryType", () => {
    for (const type of INTEGRATION_JOURNAL_ENTRY_TYPES) {
      expect(JOURNAL_ENTRY_TYPES).toContain(type);
    }
  });

  it("writes exactly two members — never a 3rd, undeclared journal-entry type", () => {
    expect(INTEGRATION_JOURNAL_ENTRY_TYPES).toHaveLength(2);
  });

  it("is disjoint from 07's own two members (git_freeze/worktree_quarantine)", () => {
    expect(INTEGRATION_JOURNAL_ENTRY_TYPES).not.toContain("git_freeze");
    expect(INTEGRATION_JOURNAL_ENTRY_TYPES).not.toContain("worktree_quarantine");
  });

  it("a constructed cas_ref_update entry round-trips through @eo/journal's own JournalEntrySchema", () => {
    const candidate = {
      schemaVersion: 1,
      seq: 1,
      type: "cas_ref_update" as const,
      payload: {
        ref: "refs/heads/feat/example",
        objectId: "a".repeat(40),
      },
      prevHash: "0".repeat(64),
      hash: "1".repeat(64),
      timestamp: new Date().toISOString(),
    };
    expect(() => JournalEntrySchema.parse(candidate)).not.toThrow();
  });

  it("a constructed evidence_pointer entry round-trips through @eo/journal's own JournalEntrySchema", () => {
    const candidate = {
      schemaVersion: 1,
      seq: 1,
      type: "evidence_pointer" as const,
      payload: {
        schemaVersion: 1,
        id: "b0000000-0000-4000-8000-000000000001",
        changeSetId: "b0000000-0000-4000-8000-000000000002",
        command: "renderWithRegeneration:pr_title",
        exitStatus: 0,
        toolchainFingerprint: "@eo/git-engine evidence-attachment",
        capturedAt: new Date().toISOString(),
        artifactDigests: ["deadbeef"],
        objectId: "a".repeat(40),
      },
      prevHash: "0".repeat(64),
      hash: "1".repeat(64),
      timestamp: new Date().toISOString(),
    };
    expect(() => JournalEntrySchema.parse(candidate)).not.toThrow();
  });
});
