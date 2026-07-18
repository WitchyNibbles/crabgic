/**
 * On-disk layout constants — roadmap/04-journal-idempotency-leases.md §In
 * scope, "Layout" bullet; interface-ledger Gap 14 ruling ("The shared
 * cache-root constant is pinned exactly once, in Phase 04 (`packages/
 * journal`), as the sibling of Phase 04's existing `$XDG_STATE_HOME`
 * state-root bullet"). This is the SOLE definition site for both roots —
 * 05's runtime dir/registries, 07's `git-control/`, 12's
 * `capability-store/`, and 22's `learning/` all nest under the roots this
 * module exports rather than reimplementing "XDG state/cache dir" logic
 * themselves (exit criterion: "repo-wide lint/grep CI check fails if
 * another package reimplements the root instead of importing it").
 *
 * Path form (Gap 14's resolved path-segment order, `04`'s own §Risks note):
 * `<project-hash>` sits immediately under `engineering-orchestrator/`, and
 * every phase-specific subpath (`journal/`, `leases/`, `git-control/`,
 * `capability-store/`, `learning/`) nests beneath the hash segment — never
 * the reverse order (`git-control/<project-hash>/`).
 *
 * Every function here is pure: it takes the environment as an explicit
 * `XdgEnv` parameter and returns a computed path string. Nothing in this
 * module reads `process.env` directly — `readXdgEnvFromProcess` (bottom of
 * file) is the one, clearly-marked impure edge a real caller uses to
 * produce an `XdgEnv` value from the live process, kept separate from the
 * pure path-computation functions above it.
 */

import { join } from "node:path";

/** Directory permission mode for every directory this package creates (state root, journal segments/snapshots, leases). */
export const JOURNAL_DIR_MODE = 0o700;

/** File permission mode for every file this package creates (segments, snapshots, lease files). */
export const JOURNAL_FILE_MODE = 0o600;

/** The product's own namespace directory name, nested under both XDG roots. */
export const ENGINEERING_ORCHESTRATOR_DIR_NAME = "engineering-orchestrator";

/** Subdirectory names nested under `<project-hash>/` in the state root. */
export const JOURNAL_STATE_SUBDIR = "journal";
export const LEASES_STATE_SUBDIR = "leases";

/** Subdirectory names nested under `journal/` itself — this package's own organizational choice (segments vs. snapshots kept apart), not dictated by any other phase's text. */
export const JOURNAL_SEGMENTS_SUBDIR = "segments";
export const JOURNAL_SNAPSHOTS_SUBDIR = "snapshots";

/**
 * The explicit environment shape every pure function below consumes.
 * `HOME` is required (the XDG fallback base — `~/.local/state`,
 * `~/.cache`); `XDG_STATE_HOME`/`XDG_CACHE_HOME` are optional overrides per
 * the XDG Base Directory spec.
 */
export interface XdgEnv {
  readonly HOME: string;
  readonly XDG_STATE_HOME?: string;
  readonly XDG_CACHE_HOME?: string;
}

/** `$XDG_STATE_HOME`, falling back to `~/.local/state` per the XDG spec's own default. */
export function resolveXdgStateHome(env: XdgEnv): string {
  return env.XDG_STATE_HOME ?? join(env.HOME, ".local", "state");
}

/** `$XDG_CACHE_HOME`, falling back to `~/.cache` per the XDG spec's own default. */
export function resolveXdgCacheHome(env: XdgEnv): string {
  return env.XDG_CACHE_HOME ?? join(env.HOME, ".cache");
}

/**
 * `$XDG_STATE_HOME/engineering-orchestrator/<project-hash>/` — the pinned
 * state root (roadmap/04 §In scope, "Layout" bullet). `projectHash` is
 * accepted as an opaque, already-computed string; this package does not
 * define how a project hash is derived (no phase text assigns that
 * computation to 04 — `Lease.acquire(projectHash)` and this layout module
 * both simply consume it as a parameter).
 */
export function resolveStateRoot(env: XdgEnv, projectHash: string): string {
  return join(resolveXdgStateHome(env), ENGINEERING_ORCHESTRATOR_DIR_NAME, projectHash);
}

/**
 * `$XDG_CACHE_HOME/engineering-orchestrator/<project-hash>/` — the pinned
 * cache root (Gap 14). 07's `git-control/` and 12's `capability-store/`
 * nest directly under this exact path; 04 pins the root only, 07/12 own
 * writing under it.
 */
export function resolveCacheRoot(env: XdgEnv, projectHash: string): string {
  return join(resolveXdgCacheHome(env), ENGINEERING_ORCHESTRATOR_DIR_NAME, projectHash);
}

/** `.../journal/` under the state root — segments + snapshots both nest here (see `resolveJournalSegmentsDir`/`resolveJournalSnapshotsDir`). */
export function resolveJournalDir(env: XdgEnv, projectHash: string): string {
  return join(resolveStateRoot(env, projectHash), JOURNAL_STATE_SUBDIR);
}

/** `.../journal/segments/` — where `appendEntry` writes ndjson segment files. */
export function resolveJournalSegmentsDir(env: XdgEnv, projectHash: string): string {
  return join(resolveJournalDir(env, projectHash), JOURNAL_SEGMENTS_SUBDIR);
}

/** `.../journal/snapshots/` — where `writeSnapshot` writes atomic `RunSnapshot` files. */
export function resolveJournalSnapshotsDir(env: XdgEnv, projectHash: string): string {
  return join(resolveJournalDir(env, projectHash), JOURNAL_SNAPSHOTS_SUBDIR);
}

/** `.../leases/` under the state root — the per-project lease file directory (owned by another worker's lease module; this package only pins the path). */
export function resolveLeasesDir(env: XdgEnv, projectHash: string): string {
  return join(resolveStateRoot(env, projectHash), LEASES_STATE_SUBDIR);
}

/**
 * The one, clearly-marked IMPURE edge: reads `process.env`/`os.homedir()`
 * once to build an `XdgEnv` value a real caller passes into the pure
 * functions above. Every function above this point never reads
 * `process.env` itself — this is the sole boundary crossing, per this
 * worker's brief ("pure functions taking env as an explicit parameter; no
 * ambient process.env reads in the pure path").
 */
export function readXdgEnvFromProcess(): XdgEnv {
  const home = process.env.HOME;
  if (home === undefined || home.length === 0) {
    throw new Error("journal: cannot resolve XDG layout — HOME is not set in the environment");
  }
  const env: XdgEnv = {
    HOME: home,
    ...(process.env.XDG_STATE_HOME !== undefined
      ? { XDG_STATE_HOME: process.env.XDG_STATE_HOME }
      : {}),
    ...(process.env.XDG_CACHE_HOME !== undefined
      ? { XDG_CACHE_HOME: process.env.XDG_CACHE_HOME }
      : {}),
  };
  return env;
}
