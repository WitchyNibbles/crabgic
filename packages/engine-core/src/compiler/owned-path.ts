import { EnvelopeCompilationError } from "./compiler-error.js";

/**
 * `validateOwnedPath` — phase-03 security-fix round, CRITICAL 1 (validator
 * finding: `permission-profile.ts` emitted `Edit(//${path}/**)` from raw
 * `envelope.ownedPaths` with NO validation and NO worktree anchoring;
 * `//` is the FILESYSTEM-ROOT anchor per adaptation §4.1 ("`//abs/path/**`
 * (filesystem root)") and Appendix B's own sketch
 * (`Edit(//abs/path/worktree/**)` — `//` followed by an ABSOLUTE path, not
 * a bare relative one). `ownedPaths:["etc/cron.d"]` compiled to
 * `Edit(//etc/cron.d/**)`, i.e. `/etc/cron.d/**` — an absolute
 * system-directory grant from an innocuous-looking relative path).
 *
 * A legitimate owned path is worktree-RELATIVE (e.g. `src`,
 * `packages/app/src`). This function REJECTS ("Validate at system
 * boundaries; fail fast with clear error messages") anything that, after
 * trim, is:
 *
 * - empty;
 * - absolute (leading `/`);
 * - home-anchored (leading `~`);
 * - carrying a `..` path segment (traversal);
 * - carrying a glob metacharacter (`*`, `?`, `[`, `]`, `{`, `}`, `\`) —
 *   owned paths are literal directory names, never patterns.
 *
 * A valid path's trailing slash(es) are stripped so the caller can safely
 * concatenate `/**` without a doubled slash.
 *
 * ENGINE-FACT-DRIFT (mandatory per CLAUDE.md's engine-fact-drift ground
 * rule; interface-ledger Gap-12 precedent — an unresolved engine-notation
 * question must be flagged, never silently invented): `docs/engine-
 * baseline.md` §3 (Permission probes) records NO path-anchor probe at all
 * — every recorded probe there is Bash-prefix/colon-spacing behavior. The
 * exact real-engine matching semantics of the `//<worktree-abs-path>/**`
 * form THIS COMPILER NOW COMMITS TO (worktree-anchored, via the shared
 * `WORKTREE_WRITE_PLACEHOLDER` token phase 06 substitutes with the real
 * absolute worktree path before ever calling the engine) are UNVERIFIED —
 * whether the live engine treats `//` + an absolute path exactly as
 * adaptation §4.1's doc text states, whether a doubled leading slash after
 * substitution ever arises, and how `//` interacts with WSL2 path forms
 * are all open. This is a phase-00-style probe still OWED to phase 06's
 * `@live` conformance suite — see `../../README.md`'s "Engine-fact-drift
 * gap" section for the same text recorded there, and carry this forward to
 * `docs/interface-ledger.md` at the next reconcile (this worker does not
 * edit the ledger directly).
 */
export function validateOwnedPath(rawPath: string): string {
  const trimmed = rawPath.trim();

  if (trimmed.length === 0) {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.ownedPaths entry is empty after trimming: ${JSON.stringify(rawPath)}`,
    );
  }
  if (trimmed.startsWith("/")) {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.ownedPaths entry must be worktree-relative, not absolute: ${JSON.stringify(rawPath)}`,
    );
  }
  if (trimmed.startsWith("~")) {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.ownedPaths entry must be worktree-relative, not home-anchored: ${JSON.stringify(rawPath)}`,
    );
  }
  if (trimmed.split("/").some((segment) => segment === "..")) {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.ownedPaths entry must not contain a '..' path segment: ${JSON.stringify(rawPath)}`,
    );
  }
  if (GLOB_METACHARACTER_PATTERN.test(trimmed)) {
    throw new EnvelopeCompilationError(
      `AuthorizationEnvelope.ownedPaths entry must not contain glob metacharacters: ${JSON.stringify(rawPath)}`,
    );
  }

  return trimmed.replace(/\/+$/, "");
}

const GLOB_METACHARACTER_PATTERN = /[*?[\]{}\\]/;
