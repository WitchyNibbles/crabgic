/**
 * SEAM DECISION (roadmap/03-envelope-compiler-engine-adapter.md; this
 * worker's brief) — recorded in full in `../../README.md`'s "Seam
 * decision" section.
 *
 * Phase 03 depends only on phase 00 + phase 02 (roadmap/README.md
 * dependency graph: `P00 --> P03`, `P02 --> P03`) and must NOT import
 * `@crabgic/journal` (phase 04) — interface-ledger Gap 14 assigns phase 04
 * ownership of the canonical `$XDG_STATE_HOME`/`$XDG_CACHE_HOME` runtime
 * root constants (nested further under a per-project hash, e.g.
 * `$XDG_CACHE_HOME/crabgic/<project-hash>/git-control/`).
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
 * State root (`~/.local/state/crabgic/**`) is assumed to
 * hold journal + control data; cache root
 * (`~/.cache/crabgic/**`) is assumed to hold the control
 * clone — mirroring Gap 14's own state-root/cache-root split.
 *
 * CARRY-FORWARD DISCHARGED (2026-08-01). The gap this comment predicted —
 * "a non-default `$XDG_STATE_HOME` must not create a gap between what this
 * compiler denies and where the journal actually lives" — was real and
 * reachable, not merely theoretical: the engine's own `Write`/`Edit` tools
 * execute OUTSIDE the bubblewrap boundary
 * (`docs/evidence/phase-06/sandbox-containment-determination.json`, arm
 * `sandbox-write-tool`), so for those tools these deny RULES are the only
 * thing between a worker and the journal, and under a custom
 * `$XDG_STATE_HOME` they named a path the journal was not in.
 *
 * The fix keeps the seam: this package still does not import
 * `@crabgic/journal`. `compileEnvelope` now accepts the caller's already-
 * resolved runtime roots (`RuntimeRootsDenyInput`) and denies those IN
 * ADDITION to the literals below. The literals stay because they remain
 * correct when the env vars are unset, and because deny-wins means an extra
 * deny can never loosen anything.
 */
export const CONTROL_REPO_STATE_ROOT_DENY_PATH = "~/.local/state/crabgic/**";

/** See `CONTROL_REPO_STATE_ROOT_DENY_PATH`'s doc comment — same seam decision. */
export const CONTROL_REPO_CACHE_ROOT_DENY_PATH = "~/.cache/crabgic/**";

/** Mandatory credential-path deny (adaptation §4.2, §5.1, Appendix B). */
export const SSH_DENY_PATH = "~/.ssh/**";

/** Mandatory credential-path deny (adaptation §4.2, §5.1, Appendix B). */
export const AWS_DENY_PATH = "~/.aws/**";

/**
 * The caller's REAL, already-resolved runtime roots — the concrete
 * directories `@crabgic/journal` actually uses for this host and user, which
 * only a caller that can read the environment knows.
 *
 * Supplied to `compileEnvelope` so the compiled denies cover where the
 * journal and control clone genuinely live, not merely where the XDG spec
 * defaults put them. Both are directory paths WITHOUT a trailing glob; the
 * compiler appends `/**` itself, exactly as it does for the literals above.
 */
export interface RuntimeRootsDenyInput {
  /** Absolute path of the resolved state root holding the journal and control state (e.g. `$XDG_STATE_HOME/crabgic`). */
  readonly stateRoot: string;
  /** Absolute path of the resolved cache root holding the control clone (e.g. `$XDG_CACHE_HOME/crabgic`). */
  readonly cacheRoot: string;
}

/**
 * The full mandatory deny set: the tilde-default literals plus, when the
 * caller supplied them, its resolved roots. De-duplicated, because a default
 * environment resolves to exactly the literals and emitting each twice would
 * be noise in every golden profile.
 */
export function mandatoryPathDenyRoots(runtimeRoots?: RuntimeRootsDenyInput): readonly string[] {
  const resolved =
    runtimeRoots === undefined
      ? []
      : [`${runtimeRoots.stateRoot}/**`, `${runtimeRoots.cacheRoot}/**`];
  return [
    ...new Set([
      CONTROL_REPO_STATE_ROOT_DENY_PATH,
      CONTROL_REPO_CACHE_ROOT_DENY_PATH,
      ...resolved,
      SSH_DENY_PATH,
      AWS_DENY_PATH,
    ]),
  ];
}
