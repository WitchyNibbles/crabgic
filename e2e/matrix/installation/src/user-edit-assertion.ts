/**
 * The uninstall-preserving-user-edits assertion — roadmap/23-release-
 * hardening.md work item 3's fail-first vector, verbatim: "a seeded fixture
 * where the installer SILENTLY OVERWRITES a user edit must FAIL the
 * harness before the assertion is in place." This module IS "the
 * assertion" that vector refers to: a pure function over an uninstall
 * result's own `outcomes` array (no I/O), so its own correctness can be
 * proven with a seeded FAKE outcome set representing a broken installer
 * (see `test/user-edit-assertion.test.ts`'s RED/GREEN pair) independently
 * of any real installer run.
 */

export interface UninstallOutcomeLike {
  readonly relPath: string;
  readonly action: "removed" | "restored" | "preserved-drifted" | "already-absent";
}

export interface UserEditOverwriteViolation {
  readonly relPath: string;
  readonly action: UninstallOutcomeLike["action"];
}

/**
 * Every `relPath` in `driftedRelPaths` (paths this harness itself knows
 * carry a real, seeded user edit — verified independently by the caller,
 * e.g. by reading the file's own content before uninstall) whose uninstall
 * `action` was NOT `"preserved-drifted"`. A correct installer must ALWAYS
 * report `"preserved-drifted"` for a drifted artifact (roadmap/10 §In
 * scope: "removes only unchanged owned content"); `"removed"` or
 * `"restored"` for a drifted path means the user's edit was silently
 * discarded/overwritten — exactly the bug this function exists to catch.
 * `"already-absent"` is ALSO a violation here: a real drifted file cannot
 * legitimately have been already-absent (this harness only calls this
 * function against a file it itself confirmed exists and is drifted).
 */
export function findUserEditOverwriteViolations(
  outcomes: readonly UninstallOutcomeLike[],
  driftedRelPaths: readonly string[],
): readonly UserEditOverwriteViolation[] {
  const driftedSet = new Set(driftedRelPaths);
  const violations: UserEditOverwriteViolation[] = [];
  for (const outcome of outcomes) {
    if (!driftedSet.has(outcome.relPath)) continue;
    if (outcome.action !== "preserved-drifted") {
      violations.push({ relPath: outcome.relPath, action: outcome.action });
    }
  }
  return violations;
}

export class UserEditOverwrittenError extends Error {
  readonly violations: readonly UserEditOverwriteViolation[];

  constructor(violations: readonly UserEditOverwriteViolation[]) {
    const paths = violations.map((v) => `${v.relPath} (action: ${v.action})`).join(", ");
    super(
      `installation-matrix: uninstall silently discarded a user edit in ${violations.length} artifact(s): ${paths} — expected "preserved-drifted" for every one`,
    );
    this.name = "UserEditOverwrittenError";
    this.violations = violations;
  }
}

/** Throws `UserEditOverwrittenError` if `findUserEditOverwriteViolations` finds anything; otherwise resolves silently. */
export function assertUserEditsPreserved(
  outcomes: readonly UninstallOutcomeLike[],
  driftedRelPaths: readonly string[],
): void {
  const violations = findUserEditOverwriteViolations(outcomes, driftedRelPaths);
  if (violations.length > 0) {
    throw new UserEditOverwrittenError(violations);
  }
}
