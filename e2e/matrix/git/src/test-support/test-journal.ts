/**
 * Test-support helper — a fresh, real `@eo/journal` `JournalStore` over a
 * temp directory. Mirrors `e2e/matrix/installation/src/test-support/
 * test-journal.ts` / `e2e/report/src/test-support/test-journal.ts`'s own
 * identical pattern, reproduced locally rather than imported (neither
 * sibling project is a dependency of this one).
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
  const journalDir = await mkdtemp(join(tmpdir(), "eo-git-matrix-journal-"));
  const store = createJournalStore({ journalDir });
  return {
    store,
    journalDir,
    cleanup: async () => {
      await rm(journalDir, { recursive: true, force: true });
    },
  };
}
