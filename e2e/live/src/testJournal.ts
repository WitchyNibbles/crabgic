import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournalStore, type JournalStore } from "@crabgic/journal";

/**
 * A fresh, real `@crabgic/journal` `JournalStore` over a temp directory — mirrors
 * `e2e/report/src/test-support/test-journal.ts` / `e2e/matrix/orchestration/
 * src/testJournal.ts`'s own established pattern in this same phase. This
 * project's dependency edge is deliberately limited to `@crabgic/contracts` +
 * `@crabgic/journal` for its evidence-emission path (`./evidence.ts`), matching
 * every sibling phase-23 harness's own documented constraint.
 *
 * SHARED-JOURNAL MODE (`CRABGIC_RELEASE_GATE_JOURNAL_DIR`): the private temp
 * directory is exactly why every `EvidenceRecord` this harness genuinely
 * emitted used to be unreadable by `e2e/report`'s generator — it was
 * written to a directory that ceased to exist before the report ran, so
 * every checklist item scored EVIDENCE-PENDING against real, green runs.
 * When that env var is set, this helper writes into that ONE directory
 * instead, the same one `e2e/report/src/cli.ts` resolves its READ journal
 * from, so a whole release run accumulates into a single journal the
 * report can actually link evidence out of.
 *
 * `cleanup()` is a deliberate NO-OP in that mode. Removing the shared
 * journal would delete every OTHER harness's evidence along with this
 * one's — the precise records the report is about to be generated from —
 * and the deletion would happen in an `afterEach`, long before the report
 * step runs. The directory is CI's (or the invoking operator's) to own and
 * dispose of, never an individual test's.
 *
 * With the env var unset — the default, and how the normal gate runs —
 * behaviour is unchanged: a private `mkdtemp` directory, really removed on
 * `cleanup()`. An empty value counts as unset, since it is never a usable
 * journal directory and must not silently redirect writes to the process
 * CWD.
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
