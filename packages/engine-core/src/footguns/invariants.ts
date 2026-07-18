import type { CompiledWorkerProfile } from "../compiler/compiled-worker-profile.js";
import {
  CONTROL_REPO_STATE_ROOT_DENY_PATH,
  CONTROL_REPO_CACHE_ROOT_DENY_PATH,
  SSH_DENY_PATH,
  AWS_DENY_PATH,
} from "../compiler/xdg-default-paths.js";
import { WORKTREE_WRITE_PLACEHOLDER } from "../compiler/worktree-placeholders.js";

/**
 * Footgun-invariant checkers (roadmap/03-envelope-compiler-engine-
 * adapter.md work item 4; adaptation Appendix B's own warning). Each
 * function throws a dedicated, named error when the invariant it checks is
 * violated — used both to assert the REAL compiler never violates them
 * (`../footguns/*.test.ts`) and to prove each seeded mutation-test variant
 * IS caught (`mutation.test.ts`).
 */

export class BlanketMcpDenyViolationError extends Error {
  constructor() {
    super(
      "compiled permission profile denies 'mcp__*' — this shadows the mandatory gateway allow " +
        "entry, since a deny beats an allow at any level (adaptation Appendix B's own warning).",
    );
    this.name = "BlanketMcpDenyViolationError";
  }
}

/** A blanket `mcp__*` deny must never appear — it would shadow the mandatory gateway allow entry. */
export function assertNoBlanketMcpDeny(profile: CompiledWorkerProfile): void {
  if (profile.permissions.deny.includes("mcp__*")) {
    throw new BlanketMcpDenyViolationError();
  }
}

export class MissingMandatoryDenyReadPathError extends Error {
  constructor(readonly missingPath: string) {
    super(
      `compiled sandbox profile's filesystem.denyRead is missing mandatory path: ${missingPath}`,
    );
    this.name = "MissingMandatoryDenyReadPathError";
  }
}

const MANDATORY_SANDBOX_DENY_READ_PATHS: readonly string[] = [
  CONTROL_REPO_STATE_ROOT_DENY_PATH,
  CONTROL_REPO_CACHE_ROOT_DENY_PATH,
  SSH_DENY_PATH,
  AWS_DENY_PATH,
];

/** The four mandatory sandbox `denyRead` paths (control-repo state+cache root, `~/.ssh`, `~/.aws`) must always be present, for any envelope. */
export function assertMandatoryDenyReadPathsPresent(profile: CompiledWorkerProfile): void {
  for (const path of MANDATORY_SANDBOX_DENY_READ_PATHS) {
    if (!profile.sandbox.filesystem.denyRead.includes(path)) {
      throw new MissingMandatoryDenyReadPathError(path);
    }
  }
}

export class SpaceBeforeColonBashLiteralError extends Error {
  constructor(readonly offendingRule: string) {
    super(
      `compiled permission profile emits a space-before-colon Bash rule: ${offendingRule} — ` +
        "interface-ledger Gap 12 requires no space before the colon.",
    );
    this.name = "SpaceBeforeColonBashLiteralError";
  }
}

/** Matches any `Bash(...)` rule with whitespace immediately before its trailing `:*)`. */
const SPACE_BEFORE_COLON_PATTERN = /^Bash\(.*\s:\*\)$/;

/** No emitted `Bash(...)` rule may carry a space before the colon (interface-ledger Gap 12). */
export function assertNoSpaceBeforeColonBashLiteral(profile: CompiledWorkerProfile): void {
  const offending = [...profile.permissions.allow, ...profile.permissions.deny].find((rule) =>
    SPACE_BEFORE_COLON_PATTERN.test(rule),
  );
  if (offending !== undefined) {
    throw new SpaceBeforeColonBashLiteralError(offending);
  }
}

/**
 * CRITICAL 1 fix, defect (1): the compiled profile's `Edit`/`Write` allow
 * rules must always carry the shared `WORKTREE_WRITE_PLACEHOLDER` anchor —
 * i.e. `Edit(//<worktree>/${relpath}/**)` — never a raw, unanchored
 * `Edit(//${path}/**)`. This is the structural signature of the pre-fix
 * defect: a raw owned path baked directly after the `//` filesystem-root
 * anchor with no placeholder for phase 06 to substitute.
 */
export class UnanchoredOwnedPathAllowError extends Error {
  constructor(readonly offendingRule: string) {
    super(
      `compiled permission profile emits an Edit/Write allow rule not anchored under the ` +
        `worktree placeholder: ${offendingRule} — every owned-path allow rule must be spelled ` +
        `//${WORKTREE_WRITE_PLACEHOLDER}/<relpath>/**.`,
    );
    this.name = "UnanchoredOwnedPathAllowError";
  }
}

const WORKTREE_ANCHORED_PATH_RULE_PREFIX = `//${WORKTREE_WRITE_PLACEHOLDER}/`;

/** Every `Edit(...)`/`Write(...)` allow rule must be anchored under the shared worktree placeholder. */
export function assertAllOwnedPathAllowRulesAreWorktreeScoped(
  profile: CompiledWorkerProfile,
): void {
  for (const rule of profile.permissions.allow) {
    if (!rule.startsWith("Edit(") && !rule.startsWith("Write(")) {
      continue;
    }
    const inner = rule.slice(rule.indexOf("(") + 1, -1);
    if (!inner.startsWith(WORKTREE_ANCHORED_PATH_RULE_PREFIX)) {
      throw new UnanchoredOwnedPathAllowError(rule);
    }
  }
}

/**
 * CRITICAL 1 fix, defect (2): Edit/Write deny BACKSTOPS (defense-in-depth,
 * deny-wins) for every mandatory sensitive path root, plus the worktree's
 * own `.git` internals — mirrors `permission-profile.ts`'s
 * `MANDATORY_PATH_DENY` composition exactly.
 */
export class MissingEditWriteDenyBackstopError extends Error {
  constructor(readonly missingRule: string) {
    super(
      `compiled permission profile's deny list is missing mandatory Edit/Write backstop rule: ${missingRule}`,
    );
    this.name = "MissingEditWriteDenyBackstopError";
  }
}

const MANDATORY_EDIT_WRITE_DENY_BACKSTOP: readonly string[] = [
  ...MANDATORY_SANDBOX_DENY_READ_PATHS.flatMap((path) => [`Edit(${path})`, `Write(${path})`]),
  `Edit(//${WORKTREE_WRITE_PLACEHOLDER}/.git/**)`,
  `Write(//${WORKTREE_WRITE_PLACEHOLDER}/.git/**)`,
];

/** The mandatory Edit/Write deny backstop rules must always be present in the compiled deny list. */
export function assertEditWriteDenyBackstopPresent(profile: CompiledWorkerProfile): void {
  for (const rule of MANDATORY_EDIT_WRITE_DENY_BACKSTOP) {
    if (!profile.permissions.deny.includes(rule)) {
      throw new MissingEditWriteDenyBackstopError(rule);
    }
  }
}

/** Runs every footgun invariant check against `profile`; throws on the first violation found. */
export function assertNoFootguns(profile: CompiledWorkerProfile): void {
  assertNoBlanketMcpDeny(profile);
  assertMandatoryDenyReadPathsPresent(profile);
  assertNoSpaceBeforeColonBashLiteral(profile);
  assertAllOwnedPathAllowRulesAreWorktreeScoped(profile);
  assertEditWriteDenyBackstopPresent(profile);
}
