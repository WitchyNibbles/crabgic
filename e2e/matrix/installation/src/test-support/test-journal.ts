/**
 * Test-support helper — a fresh, real `@eo/journal` `JournalStore` over a
 * temp directory. Mirrors `e2e/report/src/test-support/test-journal.ts`'s
 * own documented pattern rather than importing it (that file is not part
 * of any public surface either, and this project's own dependency edge has
 * no other reason to touch `e2e/report`).
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
  const journalDir = await mkdtemp(join(tmpdir(), "eo-installation-matrix-journal-"));
  const store = createJournalStore({ journalDir });
  return {
    store,
    journalDir,
    cleanup: async () => {
      await rm(journalDir, { recursive: true, force: true });
    },
  };
}
