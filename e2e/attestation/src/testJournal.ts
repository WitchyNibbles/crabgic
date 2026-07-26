import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournalStore, type JournalStore } from "@crabgic/journal";

/**
 * A fresh, real `@crabgic/journal` `JournalStore` — byte-for-byte the same
 * shared-journal contract every sibling harness in this phase already
 * implements (`e2e/matrix/orchestration/src/testJournal.ts`,
 * `e2e/live/src/testJournal.ts`, `e2e/matrix/connector/src/support/
 * evidence.ts`). Reproduced locally rather than imported, per this phase's
 * established per-project dependency-edge convention.
 *
 * SHARED-JOURNAL MODE (`CRABGIC_RELEASE_GATE_JOURNAL_DIR`): when that env var is
 * set and non-empty, every harness writes into the ONE directory
 * `e2e/report/src/cli.ts` later reads its evidence from — the mechanism that
 * makes a release run's evidence visible to the report generator at all.
 * `cleanup()` is a deliberate NO-OP in that mode: removing the shared
 * journal would destroy every sibling harness's evidence too. Disposing of
 * it belongs to whoever set the variable.
 *
 * Unset (the default) behaviour is a private `mkdtemp` directory, really
 * removed on `cleanup()`. An empty value counts as unset.
 */
export interface TestJournal {
  readonly store: JournalStore;
  readonly journalDir: string;
  cleanup(): Promise<void>;
}

export async function createTestJournal(): Promise<TestJournal> {
  const sharedJournalDir = process.env["CRABGIC_RELEASE_GATE_JOURNAL_DIR"];
  if (sharedJournalDir !== undefined && sharedJournalDir !== "") {
    await mkdir(sharedJournalDir, { recursive: true });
    return {
      store: createJournalStore({ journalDir: sharedJournalDir }),
      journalDir: sharedJournalDir,
      cleanup: () => Promise.resolve(),
    };
  }

  const journalDir = await mkdtemp(join(tmpdir(), "eo-attestation-"));
  const store = createJournalStore({ journalDir });
  return {
    store,
    journalDir,
    cleanup: async () => {
      await rm(journalDir, { recursive: true, force: true });
    },
  };
}
