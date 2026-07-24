import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GIT_MATRIX_SCENARIOS } from "../src/scenarios/index.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

/**
 * The full git-invariance + neutral-rendering matrix, run end-to-end in
 * one pass — roadmap/23-release-hardening.md work item 5's own
 * release-gate shape: every scenario must independently pass AND emit its
 * own `release-gate:git-matrix`-tagged `EvidenceRecord`.
 */
describe("git matrix: full run (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("every scenario in the matrix passes and emits exactly one evidence_pointer entry each", async () => {
    for (const scenario of GIT_MATRIX_SCENARIOS) {
      const outcome = await scenario(journal.store);
      expect(outcome.passed).toBe(true);
    }

    const entries = [];
    for await (const entry of journal.store.queryEntries({ type: "evidence_pointer" })) {
      entries.push(entry);
    }
    expect(entries).toHaveLength(GIT_MATRIX_SCENARIOS.length);
    for (const entry of entries) {
      if (entry.type === "evidence_pointer") {
        expect(entry.payload.gateTag).toBe("release-gate:git-matrix");
        expect(entry.payload.exitStatus).toBe(0);
      }
    }
  });
});
