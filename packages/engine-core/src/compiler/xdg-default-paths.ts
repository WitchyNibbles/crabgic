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
  /**
   * The subdirectories of each project's cache root a worker must never
   * mutate — `git-control`, `worktree-quarantine`, and their kind.
   *
   * ⚠️ SUPPLIED BY THE CALLER BECAUSE THE NAMES ARE NOT THIS PACKAGE'S.
   * They belong to `@crabgic/git-engine`'s `layout.ts`, which this package
   * must not import (phase graph; Gap 14 gives that module the sole say over
   * its own subpaths). Passing them keeps one definition site.
   *
   * WHY THIS EXISTS AT ALL — measured 2026-09-06. The blanket
   * `Edit(<cacheRoot>/**)` / `Write(<cacheRoot>/**)` was written when the
   * cache root was assumed to hold "the control clone" (see this file's own
   * header). Phase 07 then chose to nest the attempt WORKTREES under the same
   * root — its own documented path choice — so the blanket deny came to cover
   * the one place every worker must write. Deny-wins made the correctly
   * substituted `Edit(//<worktree>/<owned>/**)` allow lose to it, and every
   * legitimate edit adjudicated `deny`.
   *
   * When supplied, `Edit`/`Write` deny these subtrees PRECISELY instead of the
   * whole cache root. `Read` is deliberately unchanged, and so is the sandbox's
   * own `filesystem.denyRead` — this narrows exactly the two tools whose
   * verdicts the measurement falsified, and nothing else.
   *
   * RESIDUAL, STATED: with this supplied, an attempt worktree belonging to
   * ANOTHER unit or run is no longer covered by a blanket mutation deny. It
   * cannot be expressed away — the rule grammar has no negation, and a
   * sibling's path carries a random attempt token, so it cannot be enumerated
   * ahead of time either. What still stands between a worker and one is its
   * own allow list, which names only its own owned paths. Absent or empty,
   * every caller keeps the previous blanket behaviour unchanged.
   */
  readonly cacheRootProtectedSubdirs?: readonly string[];
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

/**
 * The mandatory deny roots as they apply to the MUTATION tools (`Edit`,
 * `Write`) — `mandatoryPathDenyRoots` with each blanket cache-root entry
 * replaced by the caller's protected subdirectories, when it named any.
 *
 * Identical to `mandatoryPathDenyRoots` when no subdirectories are supplied,
 * so a caller that passes none is byte-for-byte unchanged.
 */
export function mandatoryMutationDenyRoots(
  runtimeRoots?: RuntimeRootsDenyInput,
): readonly string[] {
  const roots = mandatoryPathDenyRoots(runtimeRoots);
  const subdirs = runtimeRoots?.cacheRootProtectedSubdirs ?? [];
  if (subdirs.length === 0) return roots;
  const cacheBlankets = new Set([
    CONTROL_REPO_CACHE_ROOT_DENY_PATH,
    ...(runtimeRoots === undefined ? [] : [`${runtimeRoots.cacheRoot}/**`]),
  ]);
  return [
    ...new Set(
      roots.flatMap((root) =>
        cacheBlankets.has(root)
          ? // `<root>/*/<subdir>/**`: the `*` is the per-project hash segment
            // this package knows is there (see the header) without knowing how
            // it is derived.
            subdirs.map((subdir) => `${root.slice(0, -"/**".length)}/*/${subdir}/**`)
          : [root],
      ),
    ),
  ];
}
