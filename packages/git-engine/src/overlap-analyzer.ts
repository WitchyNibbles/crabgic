/**
 * Rename-aware overlap analyzer — roadmap/07-git-control-repo-worktrees.md
 * work item 7: "given candidate work units' planned write-path sets plus
 * the declared non-Git resource registry, returns a rename-aware pairwise
 * collision verdict. This is exactly the 'serialization input' 13's
 * readiness engine reads."
 *
 * `analyzeOverlap` is a PURE function over caller-supplied
 * `PlannedWriteSet`s (fast-check-friendly — no git dependency, no I/O).
 * `detectRenamesFromWorktree` is the REAL `git diff --find-renames`
 * integration that populates a `PlannedWriteSet`'s `paths`/`renames` from
 * an actual on-disk repo — the two compose (see
 * `./overlap-analyzer.test.ts`'s "real-git end-to-end" case) without the
 * pure algorithm itself ever touching `git`.
 *
 * NON-GIT RESOURCE REGISTRY — open question flagged for reconcile (per
 * roadmap §Risks: "no stated cross-phase producer anywhere in the source
 * material... a future phase (11's contract assembly is the natural
 * candidate) may want to be the actual declarer"): this module accepts the
 * registry as opaque caller-supplied config and matches it directly
 * (exact path equality against whatever a unit's own `paths` already
 * contains) — it does not invent normalization, glob-matching, or
 * discovery logic beyond that, since no phase text specifies one. A
 * registry-declared path that collides is additionally surfaced via
 * `declaredResourceCollisions` (a labeled subset of `collidingPaths`), so
 * 13's readiness engine can treat "two units both touch a shared lockfile"
 * with different severity than an ordinary path collision if it chooses to
 * — this module itself makes no such distinction in `collides` (both kinds
 * block equally).
 */

import { OPTION_TERMINATOR, assertSafeRefPositional } from "./git-arg-guard.js";
import type { GitPlumbing } from "./plumbing.js";

export interface RenamePair {
  readonly from: string;
  readonly to: string;
}

export interface PlannedWriteSet {
  readonly unitId: string;
  readonly paths: readonly string[];
  /** Renames WITHIN this unit's own plan — both `from` and `to` count as "touched" for collision purposes (a unit that renames X to Y is considered to touch both). */
  readonly renames?: readonly RenamePair[];
}

export interface NonGitResource {
  readonly path: string;
  readonly label?: string;
}

export interface CollisionVerdict {
  readonly unitA: string;
  readonly unitB: string;
  readonly collides: boolean;
  readonly collidingPaths: readonly string[];
  readonly declaredResourceCollisions: readonly string[];
}

/**
 * POSIX path normalizer — MAJOR 3 fix (2026-07-18 adversarial validation
 * round): the ORIGINAL comparison was exact string equality with zero
 * normalization, so spelling-equivalent same-file pairs (`src/a.txt` vs
 * `./src/a.txt`; `pkg/` vs `pkg`; `a//b` vs `a/b`; a non-Git registry entry
 * spelled `./package-lock.json` against a unit's own `package-lock.json`)
 * were cleared as `collides:false` — a missed collision that could let 13
 * run genuinely colliding units concurrently.
 *
 * Collapses `.` segments, `//` → `/`, and a trailing slash, producing a
 * canonical relative form. Deliberately does NOT case-fold or unicode-fold
 * (an explicit scoping decision, not an oversight): this package targets
 * case-SENSITIVE filesystems (the roadmap's own control clones/worktrees
 * live under a Linux/WSL2 cache root), so folding case would make two
 * genuinely DIFFERENT files (`A.txt` vs `a.txt`) collide, which is a worse
 * failure mode (false positive blocking unrelated work) than this fix's
 * actual target (a false-negative missed collision). Also deliberately does
 * NOT resolve `..` segments — these are caller-supplied relative plan paths
 * with no filesystem root context available here, so collapsing `..` would
 * require assuming a root this pure function is never given.
 */
export function normalizePlannedPath(rawPath: string): string {
  return rawPath
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

function effectiveTouchedPaths(set: PlannedWriteSet): Set<string> {
  const touched = new Set<string>();
  for (const path of set.paths) touched.add(normalizePlannedPath(path));
  for (const rename of set.renames ?? []) {
    touched.add(normalizePlannedPath(rename.from));
    touched.add(normalizePlannedPath(rename.to));
  }
  return touched;
}

/** Rename-aware pairwise collision verdict over every `(i, j)` pair with `i < j` in `sets`, in that order. */
export function analyzeOverlap(
  sets: readonly PlannedWriteSet[],
  nonGitResources: readonly NonGitResource[] = [],
): readonly CollisionVerdict[] {
  const resourcePaths = new Set(nonGitResources.map((r) => normalizePlannedPath(r.path)));
  const touchedPerUnit = sets.map((set) => ({
    unitId: set.unitId,
    touched: effectiveTouchedPaths(set),
  }));

  const verdicts: CollisionVerdict[] = [];
  for (let i = 0; i < touchedPerUnit.length; i++) {
    for (let j = i + 1; j < touchedPerUnit.length; j++) {
      const a = touchedPerUnit[i]!;
      const b = touchedPerUnit[j]!;
      const collidingPaths = [...a.touched].filter((p) => b.touched.has(p)).sort();
      const declaredResourceCollisions = collidingPaths.filter((p) => resourcePaths.has(p));
      verdicts.push({
        unitA: a.unitId,
        unitB: b.unitId,
        collides: collidingPaths.length > 0,
        collidingPaths,
        declaredResourceCollisions,
      });
    }
  }
  return verdicts;
}

export interface DetectedChanges {
  readonly paths: readonly string[];
  readonly renames: readonly RenamePair[];
}

/**
 * Real `git diff --find-renames --name-status <baseRef> <headRef>`
 * integration: parses the `-z`-free tab-separated `name-status` output
 * (`M\t<path>`, `A\t<path>`, `D\t<path>`, `R<score>\t<from>\t<to>`,
 * `C<score>\t<from>\t<to>`) into a `DetectedChanges` shape directly
 * composable with `analyzeOverlap`'s `PlannedWriteSet`.
 */
export async function detectRenamesFromWorktree(
  plumbing: GitPlumbing,
  repoDir: string,
  baseRef: string,
  headRef: string,
): Promise<DetectedChanges> {
  // CRITICAL 1 fix (2026-07-18 adversarial validation round): `baseRef`/
  // `headRef` are caller-influenced positionals. Without a guard, a value
  // like `--output=/abs/victim.txt` is parsed by `git diff` as a REAL flag
  // (redirecting diff output to an arbitrary file, truncating/overwriting
  // it) rather than as a literal revision — proven against real git 2.43.0
  // in `./argument-injection.regression.test.ts`. Both defense axes:
  // `OPTION_TERMINATOR` (git's own option-terminator, confirmed accepted by
  // `diff`) AND boundary-validating that neither value is flag-shaped.
  assertSafeRefPositional("baseRef", baseRef);
  assertSafeRefPositional("headRef", headRef);
  const result = await plumbing.run(
    ["diff", "--find-renames", "--name-status", OPTION_TERMINATOR, baseRef, headRef],
    { cwd: repoDir },
  );

  const paths: string[] = [];
  const renames: RenamePair[] = [];

  for (const line of result.stdout.split("\n")) {
    if (line.length === 0) continue;
    const fields = line.split("\t");
    const statusCode = fields[0]!;
    if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
      const from = fields[1];
      const to = fields[2];
      if (from !== undefined && to !== undefined) {
        renames.push({ from, to });
      }
    } else {
      const path = fields[1];
      if (path !== undefined) paths.push(path);
    }
  }

  return { paths, renames };
}
