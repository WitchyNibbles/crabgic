import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournalStore, type JournalStore } from "@eo/journal";

/**
 * A fresh, real `@eo/journal` `JournalStore` over a temp directory — mirrors
 * `e2e/report/src/test-support/test-journal.ts`'s own documented pattern
 * (itself mirroring `packages/gates/src/test-support/test-journal.ts`).
 * Exposes `journalDir` directly (not just the bound `store`) so a scenario
 * can construct a SECOND, independent `JournalStore` instance over the
 * identical on-disk directory — the mechanism every "simulated supervisor
 * restart" scenario in `../test/` uses: zero in-memory state carried over,
 * exactly what a real process restart looks like.
 */
export interface TestJournal {
  readonly store: JournalStore;
  readonly journalDir: string;
  cleanup(): Promise<void>;
}

export async function createTestJournal(): Promise<TestJournal> {
  const journalDir = await mkdtemp(join(tmpdir(), "eo-orchestration-matrix-"));
  const store = createJournalStore({ journalDir });
  return {
    store,
    journalDir,
    cleanup: async () => {
      await rm(journalDir, { recursive: true, force: true });
    },
  };
}

/** Opens a brand-new `JournalStore` instance over an EXISTING `journalDir` — the "simulated supervisor restart" primitive: no in-memory state survives, only what was durably journaled to disk. */
export function reopenJournal(journalDir: string): JournalStore {
  return createJournalStore({ journalDir });
}
