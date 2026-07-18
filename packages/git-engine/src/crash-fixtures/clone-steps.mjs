// Kill-harness fixture entry (plain .mjs, no build step needed — imports
// this package's own BUILT dist, resolved via the npm-workspace symlink at
// node_modules/@eo/git-engine) — roadmap/07-git-control-repo-worktrees.md
// Test plan: "crash tests reusing 04's kill harness (kill -9 mid-clone...)".
//
// Performs a REAL `ensureControlClone` call, wiring its `onStep` hook to
// `signalFaultPoint` (@eo/journal) — the harness SIGKILLs this process the
// instant it observes the fault-point marker on stdout, deterministically
// interrupting the operation BETWEEN two of its real internal
// checkpoints (never a timing guess).
import { signalFaultPoint } from "@eo/journal";
import { createGitPlumbing, createNodeGitSpawn, ensureControlClone } from "@eo/git-engine";

const [, , sourceRepoPath, controlDir] = process.argv;
const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });

await ensureControlClone(plumbing, {
  sourceRepoPath,
  controlDir,
  onStep: (step) => signalFaultPoint(step),
});
