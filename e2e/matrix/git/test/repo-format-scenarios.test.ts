import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runLfsPointerScenario,
  runSha256RepoScenario,
  runSubmoduleScenario,
} from "../src/scenarios/repo-format-scenarios.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

describe("git matrix: repo-format scenarios (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("a real SHA-256 repo is detected by the REAL validateRepository", async () => {
    const outcome = await runSha256RepoScenario(journal.store);
    expect(outcome.passed).toBe(true);
  });

  it("a real local-path submodule is detected by the REAL validateRepository", async () => {
    const outcome = await runSubmoduleScenario(journal.store);
    expect(outcome.passed).toBe(true);
  });

  it("a real LFS-pointer-shaped tracked file is detected without ever invoking git-lfs smudge", async () => {
    const outcome = await runLfsPointerScenario(journal.store);
    expect(outcome.passed).toBe(true);
  });
});
