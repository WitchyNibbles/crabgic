import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournalStore, type JournalStore } from "@eo/journal";

/**
 * A fresh, real `@eo/journal` `JournalStore` over a temp directory — mirrors
 * `e2e/report/src/test-support/test-journal.ts` / `e2e/matrix/orchestration/
 * src/testJournal.ts`'s own established pattern in this same phase. This
 * project's dependency edge is deliberately limited to `@eo/contracts` +
 * `@eo/journal` for its evidence-emission path (`./evidence.ts`), matching
 * every sibling phase-23 harness's own documented constraint.
 */
export interface TestJournal {
  readonly store: JournalStore;
  readonly journalDir: string;
  cleanup(): Promise<void>;
}

export async function createTestJournal(): Promise<TestJournal> {
  const journalDir = await mkdtemp(join(tmpdir(), "eo-live-conformance-"));
  const store = createJournalStore({ journalDir });
  return {
    store,
    journalDir,
    cleanup: async () => {
      await rm(journalDir, { recursive: true, force: true });
    },
  };
}
