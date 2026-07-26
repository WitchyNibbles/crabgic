/**
 * Test-support-only helper (not part of any public surface — `e2e/` is not
 * an npm workspace member and this project has no barrel) — a fresh, real
 * `@crabgic/journal` `JournalStore` over a temp directory. Mirrors
 * `packages/gates/src/test-support/test-journal.ts`'s own documented
 * pattern ("mirroring the pattern every sibling package's own test suite
 * uses") rather than importing it — that file is explicitly gates-package-
 * internal (not part of `@crabgic/gates`'s public barrel), and this project's
 * dependency edge is deliberately limited to `@crabgic/contracts` + `@crabgic/journal`
 * only (this work item's own constraint).
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJournalStore, type JournalStore } from "@crabgic/journal";

/**
 * SHARED-JOURNAL MODE (`CRABGIC_RELEASE_GATE_JOURNAL_DIR`): every harness's own
 * private temp journal is why `../cli.ts` — which already resolves its READ
 * journal from this same env var — found zero `EvidenceRecord`s matching
 * the release candidate and scored every checklist item EVIDENCE-PENDING
 * against real, green runs. Honoring the var on the WRITE side too makes a
 * release run accumulate into the one directory the report then reads.
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
  const sharedJournalDir = process.env["CRABGIC_RELEASE_GATE_JOURNAL_DIR"];
  if (sharedJournalDir !== undefined && sharedJournalDir !== "") {
    await mkdir(sharedJournalDir, { recursive: true });
    return {
      store: createJournalStore({ journalDir: sharedJournalDir }),
      journalDir: sharedJournalDir,
      cleanup: () => Promise.resolve(),
    };
  }

  const journalDir = await mkdtemp(join(tmpdir(), "eo-release-gate-report-test-"));
  const store = createJournalStore({ journalDir });
  return {
    store,
    journalDir,
    cleanup: async () => {
      await rm(journalDir, { recursive: true, force: true });
    },
  };
}
