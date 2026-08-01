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
import {
  createJournalStore,
  createNodeFsPort,
  type FsPort,
  type JournalStore,
} from "@crabgic/journal";

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

export interface CreateTestJournalOptions {
  /**
   * Opt out of `fsync` on this journal's writes. Default `false` — every
   * caller keeps the real, fully durable append path unless it asks not to.
   *
   * WHY THIS EXISTS: `appendEntry`'s durable write is `write -> fsync(file)
   * -> fsync(dir)` (roadmap/04 §In scope), i.e. TWO fsyncs per journaled
   * record. That is exactly right in production and it is what
   * `@crabgic/journal`'s own kill-harness/crash-fixture suites exist to
   * prove. It is also, measured, ~85% of the wall time of this project's
   * fast-check property suite, which journals ~1000 records purely as
   * SETUP for the thing it actually asserts on (the report generator's
   * scoring). Per-append: 3.74ms with fsync, 1.41ms without.
   *
   * WHAT IS STILL REAL when this is set: everything except the two fsync
   * syscalls. The store is a real `createJournalStore`, so the property
   * still exercises the real seq/prevHash assignment, the real SHA-256
   * hash chain, the real Zod entry validation, the real ndjson codec, the
   * real segment layout/rotation, and the real `queryEntries` read path.
   * Only the crash-durability guarantee is skipped — and no test in THIS
   * project asserts crash durability, so nothing here loses coverage.
   */
  readonly skipFsync?: boolean;
}

/**
 * A non-durable `FsPort`: the real node-backed port with `fsync` replaced
 * by a no-op. Every other operation (open/write/close/readFile/readdir/
 * stat/rename/unlink/truncate/mkdir) is the genuine article.
 */
function createNonDurableFsPort(): FsPort {
  return { ...createNodeFsPort(), fsync: () => Promise.resolve() };
}

export async function createTestJournal(
  options: CreateTestJournalOptions = {},
): Promise<TestJournal> {
  const sharedJournalDir = process.env["CRABGIC_RELEASE_GATE_JOURNAL_DIR"];
  if (sharedJournalDir !== undefined && sharedJournalDir !== "") {
    // `skipFsync` is deliberately IGNORED in shared-journal mode: that
    // directory is a real release run's accumulated evidence, read back by
    // `../cli.ts` and by other harnesses, and it outlives this process.
    // Durability is not this helper's to trade away there.
    await mkdir(sharedJournalDir, { recursive: true });
    return {
      store: createJournalStore({ journalDir: sharedJournalDir }),
      journalDir: sharedJournalDir,
      cleanup: () => Promise.resolve(),
    };
  }

  const journalDir = await mkdtemp(join(tmpdir(), "eo-release-gate-report-test-"));
  // A private temp directory this helper deletes in `cleanup()`: nothing
  // here ever needs to survive a crash.
  const store = createJournalStore({
    journalDir,
    ...(options.skipFsync === true ? { fs: createNonDurableFsPort() } : {}),
  });
  return {
    store,
    journalDir,
    cleanup: async () => {
      await rm(journalDir, { recursive: true, force: true });
    },
  };
}
