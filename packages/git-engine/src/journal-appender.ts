/**
 * Shared minimal journal-appender surface — the common shape both
 * `./intake-freeze.js` (WI5, `git_freeze` entries) and
 * `./worktree-lifecycle.js` (WI6, `worktree_quarantine` entries) accept.
 * Matches `@eo/journal`'s `JournalStore.appendEntry`/free-function
 * `appendEntry` surface (04) without depending on their concrete exported
 * types — every field shape here mirrors `@eo/journal`'s own
 * `GitFreezePayloadSchema`/`WorktreeQuarantinePayloadSchema`
 * (`packages/journal/src/codec/journal-payloads.ts`, not itself part of
 * `@eo/journal`'s public barrel).
 */

export interface GitFreezeEntryInput {
  readonly type: "git_freeze";
  readonly payload: { readonly scopePath: string; readonly reason: string };
  readonly runId?: string;
  readonly changeSetId?: string;
  readonly workUnitId?: string;
}

export interface WorktreeQuarantineEntryInput {
  readonly type: "worktree_quarantine";
  readonly payload: { readonly worktreePath: string; readonly reason: string };
  readonly runId?: string;
  readonly changeSetId?: string;
  readonly workUnitId?: string;
}

export type GitEngineJournalEntryInput = GitFreezeEntryInput | WorktreeQuarantineEntryInput;

export interface JournalAppender {
  appendEntry(input: GitEngineJournalEntryInput): Promise<unknown>;
}
