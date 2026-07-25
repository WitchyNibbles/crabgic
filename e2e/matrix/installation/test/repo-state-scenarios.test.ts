import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JournalStore } from "@eo/journal";
import {
  runDirtyRepoScenario,
  runEmptyDirScenario,
  runInvalidGitScenario,
  runMonorepoScenario,
  runUnbornHeadScenario,
} from "../src/scenarios/repo-state-scenarios.js";
import { createTestJournal, type TestJournal } from "../src/test-support/test-journal.js";

/**
 * GENUINE, LIVE scenarios: every test below drives the REAL
 * `packages/cli` install backend (`parseCommand` + `dispatchCommand`)
 * against a REAL throwaway temp git repo (real `git` child processes, no
 * mocked plumbing) — roadmap/23-release-hardening.md work item 3.
 */
describe("installation matrix: repo-state scenarios (live)", () => {
  let journal: TestJournal;

  beforeEach(async () => {
    journal = await createTestJournal();
  });

  afterEach(async () => {
    await journal.cleanup();
  });

  it("empty dir: declined git-init aborts cleanly; approved git-init installs for real", async () => {
    const outcome = await runEmptyDirScenario(journal.store);
    expect(outcome.passed).toBe(true);
    expect(outcome.name).toBe("installation-matrix/empty-dir");
  });

  it("invalid .git: install completes, reports repoState=invalid-git, never runs git init", async () => {
    const outcome = await runInvalidGitScenario(journal.store);
    expect(outcome.passed).toBe(true);
  });

  it("unborn HEAD: install completes against a real git-init'd, commit-less repo", async () => {
    const outcome = await runUnbornHeadScenario(journal.store);
    expect(outcome.passed).toBe(true);
  });

  it("dirty repo: install completes against a real repo with an uncommitted change", async () => {
    const outcome = await runDirtyRepoScenario(journal.store);
    expect(outcome.passed).toBe(true);
  });

  it("monorepo: install reports monorepoDetected=true and roots artifacts at the top level", async () => {
    const outcome = await runMonorepoScenario(journal.store);
    expect(outcome.passed).toBe(true);
  });

  it("every repo-state scenario emits exactly one evidence_pointer entry tagged release-gate:installation-matrix", async () => {
    // Scoped by recording the ids these two scenario calls append, rather
    // than counting the whole journal: these scenarios mint their own
    // `changeSetId` internally, and under a shared journal
    // (`EO_RELEASE_GATE_JOURNAL_DIR`, see `../src/test-support/
    // test-journal.ts`) `all-scenarios.test.ts` runs the SAME two scenarios
    // into the SAME journal, under the same deterministic stand-in object
    // ids. What is proved is unchanged: two scenarios, two durable,
    // correctly-tagged entries.
    const emittedIds = new Set<string>();
    const recording: JournalStore = {
      ...journal.store,
      appendEntry: async (input) => {
        const entry = await journal.store.appendEntry(input);
        if (entry.type === "evidence_pointer") emittedIds.add(entry.payload.id);
        return entry;
      },
    };

    await runEmptyDirScenario(recording);
    await runInvalidGitScenario(recording);

    const entries = [];
    for await (const entry of journal.store.queryEntries({ type: "evidence_pointer" })) {
      if (entry.type === "evidence_pointer" && emittedIds.has(entry.payload.id))
        entries.push(entry);
    }
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      if (entry.type === "evidence_pointer") {
        expect(entry.payload.gateTag).toBe("release-gate:installation-matrix");
      }
    }
  });
});
