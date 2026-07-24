/**
 * Test-support-only helper (not part of this package's public barrel) —
 * a fresh, real `@eo/journal` `JournalStore` over a temp directory, mirroring
 * the pattern every sibling package's own test suite uses (e.g.
 * `packages/scheduler/src/executor.e2e.test.ts`'s `beforeEach`).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournalStore, type JournalStore } from "@eo/journal";

export interface TestJournal {
  readonly store: JournalStore;
  readonly journalDir: string;
  cleanup(): Promise<void>;
}

export async function createTestJournal(): Promise<TestJournal> {
  const journalDir = await mkdtemp(join(tmpdir(), "eo-gates-test-"));
  const store = createJournalStore({ journalDir });
  return {
    store,
    journalDir,
    cleanup: async () => {
      await rm(journalDir, { recursive: true, force: true });
    },
  };
}
