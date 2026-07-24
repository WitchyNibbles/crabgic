/**
 * Test-support-only helper (not part of any public surface — `e2e/` is not
 * an npm workspace member and this project has no barrel) — a fresh, real
 * `@eo/journal` `JournalStore` over a temp directory. Mirrors
 * `packages/gates/src/test-support/test-journal.ts`'s own documented
 * pattern ("mirroring the pattern every sibling package's own test suite
 * uses") rather than importing it — that file is explicitly gates-package-
 * internal (not part of `@eo/gates`'s public barrel), and this project's
 * dependency edge is deliberately limited to `@eo/contracts` + `@eo/journal`
 * only (this work item's own constraint).
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
