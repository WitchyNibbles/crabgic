// Kill-harness fixture entry — "kill -9 mid-quarantine". Real
// `quarantineWorktree` call, journaling through a REAL `@eo/journal`
// journal store rooted at `journalDir`, `onStep` wired to
// `signalFaultPoint`.
import { signalFaultPoint } from "@eo/journal";
import { createJournalStore } from "@eo/journal";
import { createGitPlumbing, createNodeGitSpawn, quarantineWorktree } from "@eo/git-engine";

const [, , repoDir, worktreePath, quarantineDir, journalDir, reason] = process.argv;
const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });
const store = createJournalStore({ journalDir });

await quarantineWorktree(plumbing, {
  repoDir,
  worktreePath,
  quarantineDir,
  reason,
  journal: store,
  onStep: (step) => signalFaultPoint(step),
});
