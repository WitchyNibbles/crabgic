import { GATEWAY_MCP_SERVER_NAME } from "@eo/contracts";
import type { AuthorizationEnvelope } from "@eo/contracts";
import { PermissionProfileSchema, type PermissionProfile } from "./compiled-worker-profile.js";
import { validateOwnedPath } from "./owned-path.js";
import { WORKTREE_WRITE_PLACEHOLDER } from "./worktree-placeholders.js";
import {
  CONTROL_REPO_STATE_ROOT_DENY_PATH,
  CONTROL_REPO_CACHE_ROOT_DENY_PATH,
  SSH_DENY_PATH,
  AWS_DENY_PATH,
} from "./xdg-default-paths.js";

/**
 * The four doc-confirmed `Bash(...)` command-prefix literals, no space
 * before the colon (interface-ledger Gap 12; adaptation Appendix B).
 * `authorizedPrefix` is the exact string that must appear in
 * `envelope.commands` for this literal to be emitted — the compiler NEVER
 * generalizes this pattern to any other prefix (Gap 12's own build-time
 * gate: "the compiler must not generalize the colon-spacing pattern to
 * any prefix beyond those four until [a phase 00] probe lands" — that
 * probe (docs/engine-baseline.md §3, "Bash colon-spacing verdict")
 * resolved the SYNTAX question, not whether this compiler may widen its
 * fixed 4-literal allowlist, which remains a closed set by this worker's
 * own brief).
 */
const MANDATORY_BASH_ALLOWLIST: ReadonlyArray<{
  readonly authorizedPrefix: string;
  readonly rule: string;
}> = [
  { authorizedPrefix: "npm run test", rule: "Bash(npm run test:*)" },
  { authorizedPrefix: "npm run build", rule: "Bash(npm run build:*)" },
  { authorizedPrefix: "git status", rule: "Bash(git status:*)" },
  { authorizedPrefix: "git diff", rule: "Bash(git diff:*)" },
];

/**
 * Mandatory tool/command denies (roadmap/03 §In scope: "mandatory denies
 * `Agent`, `WebFetch`, `WebSearch`, `Bash(git push:*)`, `Bash(curl:*)`,
 * `Bash(wget:*)`"). `Agent` denies subagent spawning by catalog-removal
 * (docs/engine-baseline.md §4.1-§4.2: the `Agent` rule name aliases the
 * live `Task` tool literal; deny enforcement is fail-closed catalog
 * removal, not call-time denial).
 */
const MANDATORY_FIXED_DENY: readonly string[] = [
  "Agent",
  "WebFetch",
  "WebSearch",
  "Bash(git push:*)",
  "Bash(curl:*)",
  "Bash(wget:*)",
];

/**
 * The four mandatory sensitive-path deny ROOTS (control-repo state+cache
 * root, `~/.ssh`, `~/.aws`; SEAM DECISION in `./xdg-default-paths.ts`).
 * Mirrored below into `Read`, `Edit`, and `Write` deny forms — phase-03
 * security-fix round, CRITICAL 1, defect (2): before this fix only `Read`
 * denies existed for these roots, with no `Edit`/`Write` backstop at all.
 */
const MANDATORY_SENSITIVE_PATH_DENY_ROOTS: readonly string[] = [
  CONTROL_REPO_STATE_ROOT_DENY_PATH,
  CONTROL_REPO_CACHE_ROOT_DENY_PATH,
  SSH_DENY_PATH,
  AWS_DENY_PATH,
];

/**
 * Mandatory path denies, `~/`-anchored (adaptation §4.2, §5.1; SEAM
 * DECISION in `./xdg-default-paths.ts` for the control-repo/journal
 * literals) — now `Read`/`Edit`/`Write` siblings for every sensitive root,
 * plus an `Edit`/`Write` backstop over the worktree's own `.git` internals
 * (Appendix B's sketch shows `Edit(//abs/path/worktree/.git/**)` as a
 * deny; this compiler had dropped it entirely before this fix). This is
 * defense-in-depth (deny-wins): the OS sandbox's `filesystem.denyRead`
 * already blocks reads of the sensitive roots, and workers should never
 * legitimately need to Edit/Write them either.
 */
const MANDATORY_PATH_DENY: readonly string[] = [
  ...MANDATORY_SENSITIVE_PATH_DENY_ROOTS.map((path) => `Read(${path})`),
  ...MANDATORY_SENSITIVE_PATH_DENY_ROOTS.map((path) => `Edit(${path})`),
  ...MANDATORY_SENSITIVE_PATH_DENY_ROOTS.map((path) => `Write(${path})`),
  `Edit(//${WORKTREE_WRITE_PLACEHOLDER}/.git/**)`,
  `Write(//${WORKTREE_WRITE_PLACEHOLDER}/.git/**)`,
];

/**
 * `emitPermissionProfile` — roadmap/03-envelope-compiler-engine-adapter.md
 * work item 2. Pure: only reads `envelope`, never mutates it, always
 * returns freshly-constructed arrays.
 *
 * Allow-list composition (roadmap/03 work item 2's own exit-criterion
 * test: "`permissions.allow` contains ONLY the four doc-confirmed
 * `Bash(...)` literals, the owned-path `Edit`/`Write` entries, and
 * `mcp__${GATEWAY_MCP_SERVER_NAME}__*`") — deliberately narrower than
 * adaptation Appendix B's own illustrative sketch (which additionally
 * shows unconditional `Read`/`Grep`/`Glob` allows); see `../../README.md`
 * for this recorded deviation.
 *
 * Owned-path allow entries (phase-03 security-fix round, CRITICAL 1): each
 * `envelope.ownedPaths` entry is validated by `./owned-path.js` (throws
 * `EnvelopeCompilationError` for absolute/home-anchored/`..`/glob-bearing
 * entries) and anchored under the SAME `WORKTREE_WRITE_PLACEHOLDER` token
 * `sandbox-profile.ts` uses for `filesystem.allowWrite` — `Edit(//<worktree>/
 * ${relpath}/**)` — giving phase 06 a `<worktree>` token to substitute with
 * the real absolute worktree path, exactly like the sandbox layer already
 * does. See `./owned-path.js`'s own doc comment for the full defect
 * writeup and the recorded engine-fact-drift gap.
 */
export function emitPermissionProfile(envelope: AuthorizationEnvelope): PermissionProfile {
  const ownedPathAllow = envelope.ownedPaths.flatMap((path) => {
    const relativePath = validateOwnedPath(path);
    return [
      `Edit(//${WORKTREE_WRITE_PLACEHOLDER}/${relativePath}/**)`,
      `Write(//${WORKTREE_WRITE_PLACEHOLDER}/${relativePath}/**)`,
    ];
  });

  const authorizedCommands = new Set(envelope.commands.map((command) => command.trim()));
  const bashAllow = MANDATORY_BASH_ALLOWLIST.filter((entry) =>
    authorizedCommands.has(entry.authorizedPrefix),
  ).map((entry) => entry.rule);

  const gatewayAllow = `mcp__${GATEWAY_MCP_SERVER_NAME}__*`;

  return PermissionProfileSchema.parse({
    defaultMode: "dontAsk",
    disableBypassPermissionsMode: "disable",
    allow: [...ownedPathAllow, ...bashAllow, gatewayAllow],
    deny: [...MANDATORY_FIXED_DENY, ...MANDATORY_PATH_DENY],
    ask: [],
  });
}
