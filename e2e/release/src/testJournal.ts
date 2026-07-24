import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournalStore, type JournalStore } from "@eo/journal";

/**
 * A fresh, real `@eo/journal` `JournalStore` over a temp directory — mirrors
 * `e2e/report/src/test-support/test-journal.ts` / `e2e/live/src/
 * testJournal.ts`'s own established pattern in this same phase.
 */
export interface TestJournal {
  readonly store: JournalStore;
  readonly journalDir: string;
  cleanup(): Promise<void>;
}

export async function createTestJournal(): Promise<TestJournal> {
  const journalDir = await mkdtemp(join(tmpdir(), "eo-reproducible-build-"));
  const store = createJournalStore({ journalDir });
  return {
    store,
    journalDir,
    cleanup: async () => {
      await rm(journalDir, { recursive: true, force: true });
    },
  };
}
