import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runCleanPublishScenario,
  runPublishAttributionLeakScenario,
} from "../src/scenarios/publish-attribution-leak-scenario.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("git matrix: publish-time attribution-leak scenarios (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("THE STRONGEST FAIL-FIRST PROOF: a real leaking commit is rejected by the REAL publishLocal belt-and-suspenders, and the branch ref is deleted (never left dangling)", async () => {
    const outcome = await runPublishAttributionLeakScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain("PublishedAttributionLeakError");
    expect(outcome.detail).toContain("branchDeletedAfterLeak=true");
  });

  it("a clean commit publishes for real: branch appears in the user repo, working tree stays byte-identical", async () => {
    const outcome = await runCleanPublishScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain('"status":"published"');
  });
});
