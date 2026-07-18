/**
 * Argument-injection / option-smuggling defense-in-depth — fix for the
 * 2026-07-18 adversarial validation round's CRITICAL 1 and MAJOR 2/4
 * findings against roadmap/07-git-control-repo-worktrees.md.
 *
 * `plumbing.ts`'s argv-array + `shell:false` invocation already defeats
 * SHELL injection (a metacharacter-laden argv element reaches `git` as one
 * literal token, never interpreted by a shell). But that is a DIFFERENT
 * security property from OPTION SMUGGLING: `git` itself parses each argv
 * element, and a caller-influenced POSITIONAL value that happens to start
 * with `-` is parsed by `git` as a FLAG, not a literal positional — e.g. a
 * ref value of `--upload-pack=touch pwned;git-upload-pack` passed as
 * `git fetch origin <ref>` makes git itself invoke that program on the
 * local-transport fetch path (proven empirically against real git 2.43.0
 * during this fix's RED phase — see `./argument-injection.regression.test.ts`).
 * No amount of shell-safety prevents this; only two orthogonal defenses do:
 *
 *  (i) `OPTION_TERMINATOR` (`--end-of-options`) inserted into the argv
 *      BETWEEN a command's own legitimate flags and the caller-influenced
 *      positional(s) — git's own generic `parse_options()` facility
 *      (confirmed present on `clone`, `fetch`, `diff`, and `worktree add`
 *      against real git 2.43.0; NOT honored by `rev-parse`'s own hand-rolled
 *      parser unless paired with `--verify`, per `git rev-parse --help`'s
 *      own documented example `git rev-parse --verify --end-of-options $REV`).
 *  (ii) Boundary-validating the caller value itself so it structurally
 *      cannot be flag-shaped in the first place — `assertSafeRefPositional`
 *      (git ref/revision values never legitimately start with `-`) and
 *      `assertObjectId` (a base object id is always a plain hex SHA-1/SHA-256
 *      string, never flag-shaped by construction).
 *
 * Both axes are applied together at every call site listed in the fix
 * (control-clone's clone+fetch, overlap-analyzer's diff, intake-freeze's
 * rev-parse, worktree-lifecycle's worktree-add) — belt-and-suspenders, since
 * either alone is already sufficient but neither was present before this fix.
 */

/**
 * Git's own generic option-terminator: every argument AFTER this one is
 * treated as a positional, even if it looks like a flag. Verified against
 * real git 2.43.0 for every command this package passes caller-influenced
 * positionals to: `clone`, `fetch`, `diff`, `worktree add` (accepted
 * silently — not documented in `--help` output, but functionally present
 * via `parse_options()`), and `rev-parse` (ONLY when combined with
 * `--verify`; without `--verify`, `rev-parse` echoes an unrecognized
 * `--end-of-options` to stdout instead of treating it as a terminator,
 * which would corrupt this package's `stdout.trim()` parsing — see
 * `intake-freeze.ts`'s call site for the required `--verify` pairing).
 */
export const OPTION_TERMINATOR = "--end-of-options";

/**
 * Ambient-git-config isolation for CONTROL-CONTEXT operations (fix for
 * MAJOR 2: hooks/filters not neutralized in control context). Redirects
 * git's GLOBAL and SYSTEM config sources to `/dev/null` for the duration of
 * one spawn, so an ambient `core.hooksPath` (e.g. this dev host's own
 * `~/.gitconfig`) or an ambient `filter.<x>.smudge` (e.g. `git-lfs install`'s
 * global filter registration) cannot fire during a clone or worktree
 * checkout — belt-and-suspenders alongside `repo-validation.ts`'s
 * repo-LOCAL `core.hooksPath` neutralization, which only takes effect AFTER
 * a clone's own initial checkout has already run. `GIT_TERMINAL_PROMPT=0`
 * additionally prevents any interactive credential prompt from blocking a
 * supervisor-owned, non-interactive operation.
 *
 * Deliberately NOT used for reads against the USER's own checkout (that
 * would be overreach — this package never owns the user's git config); see
 * `USER_CHECKOUT_READ_ENV` for that narrower case instead.
 */
export const CONTROL_CONTEXT_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
});

/**
 * Fix for MINOR 4: a read against the USER's checkout (freeze/validate)
 * must never mutate `.git/index` as a side effect (git's "racy git" stat-
 * cache refresh, empirically confirmed to rewrite `.git/index` bytes on a
 * plain `git status` against real git 2.43.0 during this fix's RED phase).
 * `GIT_OPTIONAL_LOCKS=0` tells git to skip that optional write entirely.
 * Paired with the `--no-optional-locks` global flag at the same call sites
 * (belt-and-suspenders — the env var and the flag are two independent
 * mechanisms for the identical git-internal switch).
 */
export const USER_CHECKOUT_READ_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_OPTIONAL_LOCKS: "0",
});

export class UnsafeGitRefError extends Error {
  readonly label: string;
  readonly value: string;

  constructor(label: string, value: string) {
    super(
      `git-arg-guard: refusing a "${label}" value that begins with "-" (git refs/revisions never legitimately do — this shape is option-smuggling, not a real ref): ${JSON.stringify(value)}`,
    );
    this.name = "UnsafeGitRefError";
    this.label = label;
    this.value = value;
  }
}

export class InvalidObjectIdError extends Error {
  readonly label: string;
  readonly value: string;

  constructor(label: string, value: string) {
    super(
      `git-arg-guard: "${label}" is not a valid hex object id (expected a 40-hex-char SHA-1 or 64-hex-char SHA-256 string): ${JSON.stringify(value)}`,
    );
    this.name = "InvalidObjectIdError";
    this.label = label;
    this.value = value;
  }
}

/**
 * Rejects a caller-supplied ref/revision positional that begins with `-`.
 * Defense axis (ii) — belt-and-suspenders alongside `OPTION_TERMINATOR`
 * (axis (i)) at the same call site. A real git ref NEVER starts with `-`
 * (git-check-ref-format(1) forbids it), so this can never reject a
 * legitimate value.
 */
export function assertSafeRefPositional(label: string, value: string): void {
  if (value.startsWith("-")) {
    throw new UnsafeGitRefError(label, value);
  }
}

const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Rejects a caller-supplied base object id that is not a plain lowercase-hex
 * SHA-1 (40 chars) or SHA-256 (64 chars) string. A real object id can never
 * be flag-shaped (it is always a fixed-length hex string), so this both
 * blocks option smuggling AND catches an ordinary caller bug (a non-OID
 * string passed where an OID was expected) in one check.
 */
export function assertObjectId(label: string, value: string): void {
  if (!OBJECT_ID_PATTERN.test(value)) {
    throw new InvalidObjectIdError(label, value);
  }
}
