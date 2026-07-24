/**
 * Merge preflight — roadmap/08-integration-publication.md work item 1:
 * "wraps `git merge-tree --write-tree` between candidate and frozen target
 * (07's intake freeze). Conflicts become typed resolution `WorkUnit`s (02
 * schema) — no auto-resolution." §Interfaces produced:
 * "`preflightMerge(candidateRef, frozenBaseObjectId): PreflightResult` ...
 * `PreflightResult` is `{ ok: true, treeId: string } | { ok: false,
 * conflicts: WorkUnit[] }`."
 *
 * SIGNATURE DEVIATION (documented, not invented silently): the roadmap
 * prose's two bare positionals omit the plumbing/repo-context every other
 * git-touching function in this package threads explicitly (`ensureControlClone`,
 * `freezeIntake`, `createWorktree` all take `(plumbing, options)`) — this
 * function follows that SAME established convention rather than the
 * two-string form literally, for consistency with the rest of the package's
 * calling surface. See docs/evidence/phase-08/README.md.
 *
 * PARAMETER RENAME — `integrationTipObjectId`, NOT the frozen base
 * (2026-07-24 adversarial-validation fix, HIGH finding): the roadmap's own
 * prose names this parameter `frozenBaseObjectId` and this file originally
 * used that name verbatim. That is SEMANTICALLY WRONG for what this
 * function must actually be called with: `git merge-tree` computes its own
 * 3-way merge base via commit-graph ancestry between the two refs it is
 * given. Every candidate this package ever preflights is, by construction,
 * a DESCENDANT of 07's real frozen intake-freeze base (`IntakeFreezeRecord
 * .baseObjectId`) — so if THAT immutable, never-advancing value were passed
 * here as the comparison side, it would always be a strict ancestor of
 * `candidateRef`, `merge-tree`'s own computed merge-base would always
 * resolve to exactly that ancestor, and the merge would ALWAYS be a trivial
 * fast-forward — clean, by construction, no matter what any OTHER
 * concurrently-preflighted candidate touched. A real cross-work-unit
 * conflict would be structurally undetectable — this preflight would be
 * vacuous against its own documented parameter.
 *
 * The value this function actually needs is the CURRENT tip of the
 * in-progress integration ref — which STARTS equal to 07's frozen base
 * (before any work unit has integrated) and ADVANCES every time
 * `applyCasUpdate` successfully lands a work unit's merge-tree result as a
 * new commit on that ref. Preflighting work unit B against the tip AFTER
 * work unit A has already integrated is what actually proves "does B's
 * candidate conflict with everything already accepted" — the caller
 * (13's scheduler, `publishLocal`'s own composition root, or 23's harness)
 * owns re-resolving this value (e.g. `git rev-parse <integration-ref>`)
 * before each preflight call; this function does not track or cache it
 * itself. See `./merge-preflight.test.ts`'s "two-work-unit integration"
 * test for the non-vacuous, end-to-end proof: work unit A's candidate is
 * preflighted clean and "integrated" (a real commit built from the
 * returned `treeId`), advancing the tip; work unit B's candidate — built
 * from the SAME original frozen base, diverging from A on the same
 * line — is THEN preflighted against that advanced tip and correctly
 * yields a conflict. Callers are responsible for supplying the CURRENT tip,
 * not the frozen base, on every call; this module does not runtime-assert
 * `integrationTipObjectId` is not an ancestor of `candidateRef` (the
 * legitimate, common "first work unit against a change set with nothing
 * integrated yet" case has the tip AS an ancestor of the candidate, and
 * correctly resolves clean — asserting otherwise would reject a valid,
 * ordinary call), but every call site's own responsibility to pass the
 * CURRENT tip (not a stale frozen snapshot) is documented here and proven
 * by the test above.
 *
 * `git merge-tree --write-tree <base> <other>` (confirmed against real git
 * 2.43.0, this phase's own spike): exit 0 + one stdout line (the tree oid)
 * on a clean merge; exit 1 + the tree oid line, THEN one
 * `<mode> <object> <stage>\t<path>` line per (stage, conflicted-path) pair,
 * THEN a blank line, THEN informational "Auto-merging"/"CONFLICT" messages,
 * on a real conflict. A GENUINE git failure (e.g. an unresolvable ref) ALSO
 * exits 1 (confirmed empirically — merge-tree does not reserve a distinct
 * exit code for "bad revision" vs. "real conflict"), but prints NOTHING to
 * stdout (the error goes to stderr only) — so this module distinguishes the
 * two by whether stdout's first line is actually a parseable tree object
 * id, not by exit code alone; any exit code other than 0/1, or exit 1 with
 * an unparseable/empty stdout, is raised as `GitCommandError`.
 * `--end-of-options` is
 * confirmed accepted by `merge-tree` (this phase's own spike, mirroring
 * `git-arg-guard.ts`'s existing confirmed set for `clone`/`fetch`/`diff`/
 * `worktree add`) — both `candidateRef` (a ref/revision positional) and
 * `integrationTipObjectId` (the current integration-ref tip) are
 * caller-influenced, so both defense axes apply here too: boundary
 * validation (`assertSafeRefPositional`/`assertObjectId`) AND the option
 * terminator, belt-and-suspenders per this package's existing discipline.
 *
 * CONTROL-CONTEXT ISOLATION (2026-07-24 adversarial-validation fix, MEDIUM
 * finding — confirmed security regression): `git merge-tree --write-tree`
 * honors a custom merge driver declared via a TRACKED `.gitattributes`
 * (`<path> merge=<name>`), whose actual driver COMMAND is read from git
 * config (`[merge "<name>"] driver = <cmd>`) — a config source this
 * invocation previously read from AMBIENT global/system config (no `env`
 * was passed at all, so the spawned `git` inherited the full
 * `process.env`), meaning an attacker- or accident-planted ambient
 * `~/.gitconfig` merge-driver declaration would EXECUTE during preflight.
 * This is a control-context operation (it operates on the control clone's
 * own object database, never a real user checkout) exactly like every
 * other control-context call in this package (`fetchRefresh`,
 * `freezeIntake`'s rev-parse, `createWorktree`'s `worktree add`,
 * `applyCasUpdate`'s own `update-ref`/`rev-parse`) — `CONTROL_CONTEXT_ENV`
 * (07's MAJOR-2 discipline: forces `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`
 * to `/dev/null`) is now passed here too, closing the same class of gap 07
 * already closed everywhere else in this package.
 */

import { randomUUID } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, WorkUnitSchema, type WorkUnit } from "@eo/contracts";
import {
  CONTROL_CONTEXT_ENV,
  OPTION_TERMINATOR,
  assertObjectId,
  assertSafeRefPositional,
} from "./git-arg-guard.js";
import { withTreeInvariance } from "./invariance.js";
import { GitCommandError, type GitPlumbing } from "./plumbing.js";

export interface PreflightMergeOptions {
  /** A real on-disk repo (the control clone, or a worktree of it) that already has both `integrationTipObjectId` and `candidateRef` reachable. */
  readonly repoDir: string;
  /** The candidate work's own ref/revision (a worktree branch, typically). */
  readonly candidateRef: string;
  /**
   * The CURRENT tip of the in-progress integration ref — NOT 07's frozen
   * intake-freeze base. See file-level doc comment ("PARAMETER RENAME") for
   * why passing the immutable frozen base here makes conflict detection
   * vacuous, and for the ownership contract (the caller re-resolves this
   * value fresh before every call, advancing it as each work unit lands).
   */
  readonly integrationTipObjectId: string;
  /** The owning `ChangeSet` — every generated resolution `WorkUnit` carries this as its `changeSetId`. */
  readonly changeSetId: string;
  /** Role stamped onto every generated resolution `WorkUnit`; default `"merge-conflict-resolution"`. */
  readonly conflictRole?: string;
}

export type PreflightResult =
  | { readonly ok: true; readonly treeId: string }
  | { readonly ok: false; readonly conflicts: readonly WorkUnit[] };

const DEFAULT_CONFLICT_ROLE = "merge-conflict-resolution";

/** Matches one `<mode> <object> <stage>\t<path>` conflict-info line from `merge-tree --write-tree`'s stdout (see this file's doc comment for the exact captured shape). */
const CONFLICT_LINE_PATTERN = /^[0-7]{6} [0-9a-f]{40,64} [123]\t(.+)$/;

/** Extracts the distinct conflicted paths from `merge-tree --write-tree`'s stdout, in first-seen order (a path appears once per stage present — 1/2/3 — but is surfaced here exactly once). */
function parseConflictedPaths(stdout: string): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const line of stdout.split("\n")) {
    const match = CONFLICT_LINE_PATTERN.exec(line);
    if (match === null) continue;
    const path = match[1]!;
    if (!seen.has(path)) {
      seen.add(path);
      ordered.push(path);
    }
  }
  return ordered;
}

function buildResolutionWorkUnit(changeSetId: string, path: string, role: string): WorkUnit {
  return WorkUnitSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: randomUUID(),
    changeSetId,
    title: `Resolve merge conflict in ${path}`,
    requirementIds: [],
    dependsOn: [],
    role,
    ownedPaths: [path],
    attemptStatus: "pending",
  });
}

/**
 * `preflightMerge(plumbing, options)` — see file-level doc comment for the
 * documented signature deviation from the roadmap's bare-positional prose,
 * AND for the `integrationTipObjectId` parameter-rename fix (2026-07-24).
 * Wrapped in `withTreeInvariance` (07's invariance harness, extended per
 * roadmap §Interfaces produced) — `merge-tree --write-tree` only ever writes
 * into the object database (`.git/objects`, ignored by the working-tree
 * hash), never touches the working tree itself, so this proves that
 * structurally rather than merely asserting it.
 */
export async function preflightMerge(
  plumbing: GitPlumbing,
  options: PreflightMergeOptions,
): Promise<PreflightResult> {
  assertSafeRefPositional("candidateRef", options.candidateRef);
  assertObjectId("integrationTipObjectId", options.integrationTipObjectId);

  const args = [
    "merge-tree",
    "--write-tree",
    OPTION_TERMINATOR,
    options.integrationTipObjectId,
    options.candidateRef,
  ];

  const result = await withTreeInvariance(options.repoDir, () =>
    // 2026-07-24 fix (MEDIUM, confirmed security regression): this is a
    // control-context operation — ambient global/system git config must be
    // neutralized so an ambient `.gitattributes`-declared merge-driver
    // command (config-sourced) cannot execute during preflight. See
    // file-level doc comment's "CONTROL-CONTEXT ISOLATION" section.
    plumbing.run(args, { cwd: options.repoDir, env: CONTROL_CONTEXT_ENV, allowFailure: true }),
  );

  const treeId = result.stdout.split("\n")[0]?.trim() ?? "";
  const treeIdLooksValid = /^[0-9a-f]{40,64}$/.test(treeId);

  if (result.exitCode !== 0 && (result.exitCode !== 1 || !treeIdLooksValid)) {
    // Either a genuinely unexpected exit code, or exit 1 with no parseable
    // tree id on stdout — a real git failure (e.g. an unresolvable ref),
    // not a conflict (see file-level doc comment).
    throw new GitCommandError(args, result.exitCode, result.stderr);
  }

  if (result.exitCode === 0) {
    return { ok: true, treeId };
  }

  const conflictedPaths = parseConflictedPaths(result.stdout);
  const role = options.conflictRole ?? DEFAULT_CONFLICT_ROLE;
  const conflicts = conflictedPaths.map((path) =>
    buildResolutionWorkUnit(options.changeSetId, path, role),
  );
  return { ok: false, conflicts };
}
