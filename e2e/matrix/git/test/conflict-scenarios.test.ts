import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCleanMergeScenario, runConflictScenario } from "../src/scenarios/conflict-scenarios.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("git matrix: conflict scenarios (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a disjoint-file candidate preflights clean via the REAL preflightMerge", async () => {
    const outcome = await runCleanMergeScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain("treeId=");
  });

  it("an intersecting-hunk candidate yields a resolution WorkUnit via the REAL preflightMerge, never a silent auto-merge", async () => {
    const outcome = await runConflictScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain("resolution WorkUnit");
  });
});
