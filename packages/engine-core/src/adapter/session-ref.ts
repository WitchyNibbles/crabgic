/**
 * `SessionRef` — an engine session, scoped to a project directory and its
 * worktrees (roadmap/03-envelope-compiler-engine-adapter.md §In scope,
 * "`EngineAdapter` interface" bullet: "`SessionRef` scoped to a project
 * directory and its worktrees, adaptation §4.5"). Adaptation §4.5: "resume
 * is scoped to the same project directory *and its worktrees* — matches
 * the per-worktree spawn model." `configDir` is the `CLAUDE_CONFIG_DIR`
 * used at spawn time (adaptation §4.5: "point `CLAUDE_CONFIG_DIR` at
 * supervisor-owned per-worker state dirs, and the transcript becomes a
 * journaled evidence artifact with a stable path" — transcript path is
 * `<configDir>/projects/<munged-cwd>/<sessionId>.jsonl`,
 * docs/engine-baseline.md §7's confirmed munged-cwd scheme).
 */
export interface SessionRef {
  /** The engine's own session identifier (a UUID, supervisor-chosen per adaptation §4.5). */
  readonly sessionId: string;
  /** Absolute path to the project directory this session (and any of its worktrees) is scoped to. */
  readonly projectDirectory: string;
  /** Absolute path to the specific worktree this session was spawned/resumed against. */
  readonly worktreePath: string;
  /** The `CLAUDE_CONFIG_DIR` this session's transcript and credentials are isolated under. */
  readonly configDir: string;
}
