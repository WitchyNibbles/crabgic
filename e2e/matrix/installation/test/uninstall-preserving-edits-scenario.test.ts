import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUninstallPreservingEditsScenario } from "../src/scenarios/uninstall-preserving-edits-scenario.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

/**
 * The GREEN counterpart of `test/user-edit-assertion.test.ts`'s seeded RED
 * proof: the SAME `assertUserEditsPreserved` assertion, now exercised
 * against a REAL install -> real out-of-band edit -> real uninstall
 * round-trip. A real installer that regressed into silently overwriting a
 * user edit would fail THIS test via the identical assertion the RED test
 * already proved catches that exact shape of bug.
 */
describe("installation matrix: uninstall-preserving-user-edits scenario (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a real user edit to CLAUDE.md survives a real uninstall, byte-for-byte", async () => {
    const outcome = await runUninstallPreservingEditsScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain('action="preserved-drifted"');
    expect(outcome.detail).toContain("still present on disk: true");
  });
});
