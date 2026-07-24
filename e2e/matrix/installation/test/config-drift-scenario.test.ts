import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runConfigDriftScenario } from "../src/scenarios/config-drift-scenario.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("installation matrix: config-drift scenario (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a real out-of-band edit to CLAUDE.md is caught by the REAL installer.checksum-drift doctor check", async () => {
    const outcome = await runConfigDriftScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain("CLAUDE.md");
  });
});
