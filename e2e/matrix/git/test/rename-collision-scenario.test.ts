import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRenameCollisionScenario } from "../src/scenarios/rename-collision-scenario.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("git matrix: rename-collision scenario (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a moved-in-one/edited-in-other pair is flagged as a collision via REAL git diff --find-renames + analyzeOverlap", async () => {
    const outcome = await runRenameCollisionScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain("collides");
  });
});
