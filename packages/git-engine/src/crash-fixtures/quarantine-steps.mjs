// Kill-harness fixture entry — "kill -9 mid-quarantine". Real
// `quarantineWorktree` call, journaling through a REAL `@crabgic/journal`
// journal store rooted at `journalDir`, `onStep` wired to
// `signalFaultPoint`.
import { signalFaultPoint } from "@crabgic/journal";
import { createJournalStore } from "@crabgic/journal";
import { createGitPlumbing, createNodeGitSpawn, quarantineWorktree } from "@crabgic/git-engine";

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
