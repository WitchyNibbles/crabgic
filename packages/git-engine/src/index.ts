/**
 * `@eo/git-engine` public barrel — roadmap/07-git-control-repo-worktrees.md
 * §Interfaces produced. Re-exported surfaces, grouped by concern (populated
 * incrementally as each work item lands):
 *
 *   - Plumbing (WI1): spawned `git`, argv-array only, no shell.
 *   - Invariance harness (WI2): exported before/after tree-hash utility,
 *     reused directly by 08 and 23.
 */

export { createGitPlumbing, createNodeGitSpawn, GitCommandError } from "./plumbing.js";
export type {
  GitPlumbing,
  GitPlumbingOptions,
  GitRunOptions,
  GitSpawnFn,
  GitSpawnRequest,
  GitSpawnResult,
} from "./plumbing.js";

export {
  assertTreeInvariant,
  computeGitStateHash,
  computeWorkingTreeHash,
  TreeMutatedError,
  withTreeInvariance,
  withUserCheckoutInvariance,
} from "./invariance.js";
export type { TreeHashOptions } from "./invariance.js";

export {
  assertObjectId,
  assertSafeRefPositional,
  CONTROL_CONTEXT_ENV,
  InvalidObjectIdError,
  OPTION_TERMINATOR,
  UnsafeGitRefError,
  USER_CHECKOUT_READ_ENV,
} from "./git-arg-guard.js";

export { neutralizeHooksPath, validateRepository } from "./repo-validation.js";
export type { RepositoryValidationReport } from "./repo-validation.js";

export { dirtyPaths, parsePorcelainV2 } from "./porcelain-parser.js";
export type {
  ConflictedEntry,
  IgnoredEntry,
  OrdinaryEntry,
  PorcelainV2Snapshot,
  RenamedOrCopiedEntry,
  UntrackedEntry,
} from "./porcelain-parser.js";

export {
  GIT_CONTROL_SUBDIR,
  resolveGitControlDir,
  resolveWorktreeQuarantineDir,
  resolveWorktreesRootDir,
  WORKTREE_QUARANTINE_SUBDIR,
  WORKTREES_SUBDIR,
} from "./layout.js";

export { ensureControlClone, fetchRefresh } from "./control-clone.js";
export type { ControlCloneOptions, ControlCloneResult } from "./control-clone.js";

export type { GitEngineJournalEntryInput, JournalAppender } from "./journal-appender.js";

export { freezeIntake } from "./intake-freeze.js";
export type {
  FreezeIntakeOptions,
  IntakeFreezeRecord,
  IntakeFreezeResult,
} from "./intake-freeze.js";

export { generateAttemptToken } from "./attempt-token.js";
export type { ClockFn, RandomHexFn } from "./attempt-token.js";

export {
  buildWorktreeRef,
  InvalidRefSegmentError,
  resolveWorktreePath,
  WorktreePathEscapeError,
} from "./worktree-ref.js";
export type { WorktreeRefParts } from "./worktree-ref.js";

export {
  ENGINEERING_ORCHESTRATOR_GIT_IDENTITY_NAME,
  configureGitIdentity,
} from "./git-identity.js";
export type { GitIdentity } from "./git-identity.js";

export {
  createWorktree,
  destroyWorktree,
  isWorktreeDirty,
  quarantineWorktree,
  sweepOrphanWorktrees,
} from "./worktree-lifecycle.js";
export type {
  CreateWorktreeOptions,
  QuarantineResult,
  QuarantineWorktreeOptions,
  SweepOptions,
  SweepReport,
  WorktreeRecord,
} from "./worktree-lifecycle.js";

export {
  analyzeOverlap,
  detectRenamesFromWorktree,
  normalizePlannedPath,
} from "./overlap-analyzer.js";
export type {
  CollisionVerdict,
  DetectedChanges,
  NonGitResource,
  PlannedWriteSet,
  RenamePair,
} from "./overlap-analyzer.js";
