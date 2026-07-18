/**
 * SEAM DECISION (roadmap/03-envelope-compiler-engine-adapter.md; this
 * worker's brief) — recorded in full in `../../README.md`'s "Seam
 * decision" section.
 *
 * Phase 03 depends only on phase 00 + phase 02 (roadmap/README.md
 * dependency graph: `P00 --> P03`, `P02 --> P03`) and must NOT import
 * `@eo/journal` (phase 04) — interface-ledger Gap 14 assigns phase 04
 * ownership of the canonical `$XDG_STATE_HOME`/`$XDG_CACHE_HOME` runtime
 * root constants (nested further under a per-project hash, e.g.
 * `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/git-control/`).
 *
 * This compiler needs *some* concrete control-repo/journal deny path to
 * seed the mandatory sandbox `denyRead`/permission `Read(...)` deny
 * entries (adaptation §4.2, §5.1: "denyRead control repo, journal,
 * `~/.ssh`, `~/.aws`") before phase 04 exists to be depended on. The
 * literals below are XDG-DEFAULT fallbacks — `~`-anchored, no
 * `$XDG_STATE_HOME`/`$XDG_CACHE_HOME` environment-variable resolution, no
 * per-project-hash nesting — deliberately simpler than Gap 14's eventual
 * pinned convention. `~/.local/state` and `~/.cache` are the XDG Base
 * Directory Specification's own documented defaults for
 * `$XDG_STATE_HOME`/`$XDG_CACHE_HOME` when those env vars are unset, so
 * these literals are a legitimate (if deliberately non-dynamic) fallback,
 * not an arbitrary guess.
 *
 * State root (`~/.local/state/engineering-orchestrator/**`) is assumed to
 * hold journal + control data; cache root
 * (`~/.cache/engineering-orchestrator/**`) is assumed to hold the control
 * clone — mirroring Gap 14's own state-root/cache-root split.
 *
 * Once phases 04 (`@eo/journal`) and 05/06 (this package's consumers) are
 * both linked, 05/06 must add a consistency test proving these defaults
 * never silently diverge from `@eo/journal`'s real runtime-resolved roots
 * (e.g. an env override, or a non-default `$XDG_STATE_HOME`, must not
 * create a gap between what this compiler denies and where the journal
 * actually lives) — this package cannot add that test itself without
 * creating the forbidden `@eo/engine-core -> @eo/journal` edge.
 */
export const CONTROL_REPO_STATE_ROOT_DENY_PATH = "~/.local/state/engineering-orchestrator/**";

/** See `CONTROL_REPO_STATE_ROOT_DENY_PATH`'s doc comment — same seam decision. */
export const CONTROL_REPO_CACHE_ROOT_DENY_PATH = "~/.cache/engineering-orchestrator/**";

/** Mandatory credential-path deny (adaptation §4.2, §5.1, Appendix B). */
export const SSH_DENY_PATH = "~/.ssh/**";

/** Mandatory credential-path deny (adaptation §4.2, §5.1, Appendix B). */
export const AWS_DENY_PATH = "~/.aws/**";
