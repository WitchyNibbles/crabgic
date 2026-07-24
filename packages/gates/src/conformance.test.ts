import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EvidenceRecordSchema, JOURNAL_ENTRY_TYPES, type JournalEntryType } from "@eo/contracts";
import { createTestJournal, type TestJournal } from "./test-support/test-journal.js";
import { createGateRegistry } from "./registry.js";
import type { GateContext } from "./types.js";

/**
 * roadmap/14 §Exit criteria: "Every emitted `EvidenceRecord` round-trips as
 * a `JournalEntryType.evidence_pointer` entry through 02's discriminated-
 * union exhaustiveness check." Mirrors `@eo/scheduler`'s own
 * `conformance.test.ts` exhaustiveness mechanism (a `Record<JournalEntryType,
 * boolean>` object literal — `npx tsc -b` fails on a missing/stray key).
 */

/** Every `JournalEntryType` member this package's own code ever appends. */
const JOURNAL_ENTRY_TYPE_USAGE: Readonly<Record<JournalEntryType, boolean>> = {
  run_transition: false,
  work_unit_transition: false,
  adjudication_decision: true, // coverage ratchet + flake quarantine (documented reuse, see their own file-level doc comments)
  remote_operation_record: false,
  evidence_pointer: true, // ./evidence.ts's emitEvidence — every gate firing
  session_assignment: false,
  git_freeze: false,
  worktree_quarantine: false,
  cas_ref_update: false,
  approval_token_mint: false,
  fanout_rationale: false,
  milestone_sync: false,
  learning_transition: false,
};

let tj: TestJournal;

beforeEach(async () => {
  tj = await createTestJournal();
});

afterEach(async () => {
  await tj.cleanup();
});

describe("JournalEntryType exhaustiveness", () => {
  it("JOURNAL_ENTRY_TYPE_USAGE declares exactly the 13 members 02 owns, one boolean each", () => {
    expect(Object.keys(JOURNAL_ENTRY_TYPE_USAGE).sort()).toEqual([...JOURNAL_ENTRY_TYPES].sort());
  });

  it("this package journals a nonempty, strict subset of JournalEntryType — never a member outside the closed union", () => {
    const used = Object.entries(JOURNAL_ENTRY_TYPE_USAGE)
      .filter(([, v]) => v)
      .map(([k]) => k);
    expect(used.sort()).toEqual(["adjudication_decision", "evidence_pointer"].sort());
  });
});

describe("every emitted EvidenceRecord round-trips as an evidence_pointer entry", () => {
  it("fires a gate, then reads the SAME EvidenceRecord back from the journal as a schema-valid evidence_pointer entry", async () => {
    const registry = createGateRegistry();
    registry.register("tdd", "roundtrip-stub", async () => ({
      passed: true,
      command: "npm test",
      exitStatus: 0,
      toolchainFingerprint: "node@24",
      artifactDigests: ["sha256:abc"],
      detail: "ok",
    }));

    const context: GateContext = {
      stage: "verifying",
      changeSetId: randomUUID(),
      requirementId: randomUUID(),
      objectId: "obj-roundtrip",
      journal: tj.store,
    };
    const [result] = await registry.fireByTag("tdd", context);

    const journaled: unknown[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      journaled.push(entry);
    }
    expect(journaled).toHaveLength(1);
    const entry = journaled[0] as { type: string; payload: unknown };
    expect(entry.type).toBe("evidence_pointer");
    // The journaled payload parses as EvidenceRecordSchema (02's own schema)
    // and is byte-identical (structurally) to what fireByTag returned.
    const reparsed = EvidenceRecordSchema.parse(entry.payload);
    expect(reparsed).toEqual(result?.evidence);
  });
});
