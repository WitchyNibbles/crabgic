// Kill-harness fixture entry — "kill -9 mid-worktree-creation" (WI6's own
// RED requirement). Real `createWorktree` call, `onStep` wired to
// `signalFaultPoint`.
import { signalFaultPoint } from "@eo/journal";
import { createGitPlumbing, createNodeGitSpawn, createWorktree } from "@eo/git-engine";

const [
  ,
  ,
  repoDir,
  worktreesRootDir,
  runId,
  changeSetId,
  taskId,
  attempt,
  baseObjectId,
  serviceEmail,
] = process.argv;
const plumbing = createGitPlumbing({ spawnFn: createNodeGitSpawn() });

await createWorktree(plumbing, {
  repoDir,
  worktreesRootDir,
  runId,
  changeSetId,
  taskId,
  attempt,
  baseObjectId,
  serviceEmail,
  onStep: (step) => signalFaultPoint(step),
});
