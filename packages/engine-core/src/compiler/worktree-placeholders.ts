/**
 * Symbolic placeholder tokens shared by every layer of the compiled
 * profile that must reference the worktree/tmp directories `compileEnvelope`
 * cannot know at compile time (`(envelope: AuthorizationEnvelope) =>
 * CompiledWorkerProfile` — no worktree/tmp-directory parameter; the
 * worktree is chosen by phase 07's control-repo/worktree machinery, a
 * later lifecycle stage this phase never sees).
 *
 * Originally defined only in `sandbox-profile.ts` (`filesystem.allowWrite`).
 * Lifted here (phase-03 security-fix round, CRITICAL 1) so
 * `permission-profile.ts`'s owned-path `Edit`/`Write` allow emission can
 * reference the SAME `<worktree>` token — before this fix, the permission
 * layer baked owned paths in RAW, with no placeholder for phase 06 to
 * substitute, while the sandbox layer already had one; the two layers now
 * share exactly one definition, both importing from this module.
 * `sandbox-profile.ts` re-exports both constants for existing consumers
 * that imported them from there.
 *
 * The real SDK-backed adapter (phase 06) is expected to substitute the
 * actual absolute worktree/tmp paths at spawn time, before ever calling
 * into the engine — see `../../README.md`'s placeholder-token convention
 * section and its engine-fact-drift note on the exact `//`-anchor
 * substitution semantics (UNPROBED by phase 00; see `owned-path.ts`'s own
 * doc comment).
 */
export const WORKTREE_WRITE_PLACEHOLDER = "<worktree>";
export const WORKER_TMP_WRITE_PLACEHOLDER = "<worker-tmp>";
