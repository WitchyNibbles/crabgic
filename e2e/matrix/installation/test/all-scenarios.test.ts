import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JournalStore } from "@eo/journal";
import { INSTALLATION_MATRIX_SCENARIOS } from "../src/scenarios/index.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

/**
 * The full 9-scenario installation matrix, run end-to-end in one pass —
 * roadmap/23-release-hardening.md work item 3's own release-gate shape:
 * every scenario must independently pass AND emit its own
 * `release-gate:installation-matrix`-tagged `EvidenceRecord`.
 */
describe("installation matrix: full run (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("every scenario in the matrix passes and emits exactly one evidence_pointer entry each", async () => {
    // Each scenario mints its own `changeSetId` internally and never
    // surfaces it, so this test scopes itself by RECORDING the id of every
    // `EvidenceRecord` its own scenario calls append, then reading only
    // those back off disk. A bare journal-wide count would, under a shared
    // journal (`EO_RELEASE_GATE_JOURNAL_DIR`, see `../src/test-support/
    // test-journal.ts`), also sweep up every sibling test file's entries —
    // several of which run these very same scenarios, under the same
    // deterministic stand-in object ids. What is proved is unchanged: N
    // scenarios produce exactly N durable, correctly-tagged, readable-back
    // evidence entries.
    const emittedIds = new Set<string>();
    const recording: JournalStore = {
      ...journal.store,
      appendEntry: async (input) => {
        const entry = await journal.store.appendEntry(input);
        if (entry.type === "evidence_pointer") emittedIds.add(entry.payload.id);
        return entry;
      },
    };

    for (const scenario of INSTALLATION_MATRIX_SCENARIOS) {
      const outcome = await scenario(recording);
      expect(outcome.passed).toBe(true);
    }

    const entries = [];
    for await (const entry of journal.store.queryEntries({ type: "evidence_pointer" })) {
      if (entry.type === "evidence_pointer" && emittedIds.has(entry.payload.id))
        entries.push(entry);
    }
    expect(entries).toHaveLength(INSTALLATION_MATRIX_SCENARIOS.length);
    for (const entry of entries) {
      if (entry.type === "evidence_pointer") {
        expect(entry.payload.gateTag).toBe("release-gate:installation-matrix");
        expect(entry.payload.exitStatus).toBe(0);
      }
    }
  });
});
