import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runInterruptedUpgradeScenario,
  runRollbackScenario,
} from "../src/scenarios/upgrade-recovery-scenarios.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("installation matrix: interrupted-upgrade / rollback scenarios (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a seeded torn-upgrade marker is recovered by the REAL upgrade backend on its next call", async () => {
    const outcome = await runInterruptedUpgradeScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain("recoveredFromInterruptedUpgrade=true");
  });

  it("recovery restores the pre-crash CLAUDE.md content byte-for-byte (rollback content fidelity)", async () => {
    const outcome = await runRollbackScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain("byte-exact");
  });
});
