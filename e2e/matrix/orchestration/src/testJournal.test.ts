import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestJournal, reopenJournal } from "./testJournal.js";

const SHARED_JOURNAL_DIR_ENV = "EO_RELEASE_GATE_JOURNAL_DIR";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createTestJournal / reopenJournal", () => {
  it("creates a working JournalStore over a fresh temp directory, and reopenJournal sees prior writes", async () => {
    // runId-scoped so this holds under a shared journal too (see
    // `./testJournal.ts`): what it proves is "the entry this test appended
    // survives a reopen", not "the journal holds one entry in total".
    const runId = randomUUID();
    const journal = await createTestJournal();
    try {
      await journal.store.appendEntry({
        type: "fanout_rationale",
        runId,
        payload: { rationale: "test entry" },
      });

      const reopened = reopenJournal(journal.journalDir);
      const entries: unknown[] = [];
      for await (const entry of reopened.queryEntries({ type: "fanout_rationale", runId })) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(1);
    } finally {
      await journal.cleanup();
    }
  });

  it("cleanup() removes the temp directory (a second cleanup call is a harmless no-op)", async () => {
    const journal = await createTestJournal();
    await journal.cleanup();
    await expect(journal.cleanup()).resolves.toBeUndefined();
  });
});

describe("createTestJournal — shared-journal mode (EO_RELEASE_GATE_JOURNAL_DIR)", () => {
  it("writes into the shared directory, creating it if absent, and NEVER deletes it on cleanup", async () => {
    // The load-bearing guarantee: a release run points every harness at one
    // journal so `e2e/report`'s generator can read the evidence back. Were
    // `cleanup()` to remove that directory, the first harness to finish
    // would wipe out every other harness's `EvidenceRecord`s — the very
    // records the report is generated from.
    const parent = await mkdtemp(join(tmpdir(), "eo-shared-journal-test-"));
    const sharedDir = join(parent, "does", "not", "exist", "yet");
    vi.stubEnv(SHARED_JOURNAL_DIR_ENV, sharedDir);

    try {
      const runId = randomUUID();
      const journal = await createTestJournal();
      expect(journal.journalDir).toBe(sharedDir);

      await journal.store.appendEntry({
        type: "fanout_rationale",
        runId,
        payload: { rationale: "shared-journal entry" },
      });
      await journal.cleanup();

      // Still on disk after cleanup, and still holding the entry — exactly
      // what the report generator needs to find there later.
      expect((await stat(sharedDir)).isDirectory()).toBe(true);
      const surviving: unknown[] = [];
      for await (const entry of reopenJournal(sharedDir).queryEntries({
        type: "fanout_rationale",
        runId,
      })) {
        surviving.push(entry);
      }
      expect(surviving).toHaveLength(1);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("treats an empty value as unset — a private temp directory, really removed", async () => {
    vi.stubEnv(SHARED_JOURNAL_DIR_ENV, "");
    const journal = await createTestJournal();
    expect(journal.journalDir).not.toBe("");
    await journal.store.appendEntry({
      type: "fanout_rationale",
      runId: randomUUID(),
      payload: { rationale: "private entry" },
    });
    await journal.cleanup();
    await expect(stat(journal.journalDir)).rejects.toThrow();
  });
});
