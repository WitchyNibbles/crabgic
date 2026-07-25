import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
 *
 * SHARED-JOURNAL MODE (`EO_RELEASE_GATE_JOURNAL_DIR`): a private temp
 * directory is why this harness's genuinely-emitted `EvidenceRecord`s were
 * invisible to `e2e/report`'s generator — they were written somewhere that
 * no longer existed by the time the report ran. When that env var is set
 * (the same one `e2e/report/src/cli.ts` resolves its READ journal from),
 * this helper writes into that one shared directory instead, so a release
 * run accumulates every harness's evidence into a single readable journal.
 *
 * `cleanup()` is a deliberate NO-OP there: deleting the shared journal in
 * an `afterEach` would destroy every other harness's evidence as well as
 * this one's, well before the report step ever reads it. Disposing of that
 * directory belongs to whoever set the env var, never to an individual
 * test.
 *
 * Unset (the default, and how the normal gate runs) behaviour is
 * unchanged: a private `mkdtemp` directory, really removed on `cleanup()`.
 * An empty value counts as unset — it is never a usable journal directory.
 */
export interface TestJournal {
  readonly store: JournalStore;
  readonly journalDir: string;
  cleanup(): Promise<void>;
}

export async function createTestJournal(): Promise<TestJournal> {
  const sharedJournalDir = process.env["EO_RELEASE_GATE_JOURNAL_DIR"];
  if (sharedJournalDir !== undefined && sharedJournalDir !== "") {
    await mkdir(sharedJournalDir, { recursive: true });
    return {
      store: createJournalStore({ journalDir: sharedJournalDir }),
      journalDir: sharedJournalDir,
      cleanup: () => Promise.resolve(),
    };
  }

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
