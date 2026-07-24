import { describe, expect, it, afterEach, beforeEach } from "vitest";
import {
  buildCleanBranchNameCandidate,
  runAttributionLeakBlockedScenario,
  runCleanBranchCommitGoldenScenario,
} from "../src/scenarios/branch-commit-golden-scenarios.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("git matrix: branch/commit golden scenarios (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a clean input renders a construction-legal branch name and a well-formed commit via the REAL renderers", async () => {
    const outcome = await runCleanBranchCommitGoldenScenario(journal.store);
    expect(outcome.passed).toBe(true);
  });

  it("THE FAIL-FIRST VECTOR: a seeded attribution-leaking slug/outcome is BLOCKED by the REAL nameBranch/renderCommit", async () => {
    const outcome = await runAttributionLeakBlockedScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain('"status":"blocked"');
  });

  it("buildCleanBranchNameCandidate's own pure output never itself carries an attribution token", () => {
    const candidate = buildCleanBranchNameCandidate();
    expect(candidate).toMatch(/^chore\/[a-z0-9-]+$/);
  });
});
