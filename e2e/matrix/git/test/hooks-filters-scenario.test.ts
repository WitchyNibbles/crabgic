import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHooksNeutralizationScenario } from "../src/scenarios/hooks-filters-scenario.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("git matrix: hooks/filters neutralization scenario (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a real pre-commit hook fires before neutralization and is silenced after neutralizeHooksPath", async () => {
    const outcome = await runHooksNeutralizationScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain("hookFiredBeforeNeutralization=true");
    expect(outcome.detail).toContain("hookFiredAfterNeutralization=false");
  });
});
