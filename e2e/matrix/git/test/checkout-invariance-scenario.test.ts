import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCheckoutInvarianceScenario } from "../src/scenarios/checkout-invariance-scenario.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("git matrix: checkout-invariance scenario (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a real control-clone + fetch cycle leaves the source user repo byte-identical", async () => {
    const outcome = await runCheckoutInvarianceScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain("byte-identical");
  });
});
