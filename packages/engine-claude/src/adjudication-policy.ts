/**
 * `createEnvelopeAdjudicationPolicy` — the REAL `AdjudicationPolicy`
 * (roadmap/06-claude-engine-adapter.md work item 3) plugged behind 05's
 * journal-teed `createAdjudicationBus` (`@eo/supervisor`), replacing that
 * phase's own `denyAllPolicy` stub. The bus itself, its bounded timeout, and
 * its fail-closed-on-bridge-failure/journal-first posture are UNCHANGED by
 * this phase (README decision 12) — this module supplies only the
 * `policy` the bus wraps.
 *
 * Semantics (defense-in-depth mirror of the engine's own first-match
 * permission-rule evaluation, docs/engine-baseline.md §3 — never the sole
 * enforcement layer; the real engine's own `dontAsk` + allow-list posture
 * and the OS sandbox are the primary defenses, this policy is the
 * `AdjudicationCallback` bridge's own independent check):
 *
 *   1. ANY deny-rule match -> deny (deny wins, baseline §3: "Deny-wins-
 *      over-allow, same settings level" / "...cross settings level").
 *   2. Else an allow-rule match -> allow, `updatedInput: toolInput` (identity
 *      canonicalization in v1 — 06's `hooks.ts` PostToolUse audit hook
 *      verifies the executed tool_input matches this exact adjudicated
 *      value).
 *   3. Else -> deny (unlisted tool/call denied by default, baseline §3:
 *      "`dontAsk` auto-denies an unlisted tool").
 *
 * PRECONDITION (binding on every caller): `input.permissions` has ALREADY
 * had engine-core's `<worktree>`/`<worker-tmp>` placeholder tokens
 * substituted with real absolute paths (README decision 6 — substitution
 * happens once, at spawn time, before any engine invocation and before this
 * policy is ever constructed). This module never performs substitution
 * itself and never sees a literal `<worktree>` token.
 *
 * ENGINE-FACT CITATIONS: every rule-matching behavior below cites
 * `docs/engine-baseline.md` §3 (permission-rule semantics) or §4
 * (`Agent`/`Task` aliasing, catalog-removal deny enforcement) — never
 * memory, per this repo's ground rule.
 *
 * ---
 *
 * DIVERGENCE FROM THE @eo/testkit REFERENCE MODEL (documented, deliberate —
 * investigated, not a defect): `@eo/testkit`'s fake-engine permission
 * evaluator (`permission-evaluator.ts`/`path-matching.ts`, a devDependency
 * of this package, used only as this test suite's independent reference
 * oracle, never imported by this production module) operates on
 * PRE-substitution compiled profiles — its own `//`-anchor handling only
 * ever resolves the ONE literal `WORKTREE_WRITE_PLACEHOLDER` token
 * (`<worktree>`) and, by its own doc comment, "simply fails to match
 * anything" (denies) for any OTHER `//`-anchored literal, including a
 * genuinely-substituted absolute worktree path. This production policy's
 * own binding precondition is the opposite: it ALWAYS receives an
 * ALREADY-substituted profile. Consequently, for the `//`-anchored
 * owned-path rule family specifically, this policy and testkit's evaluator
 * are EXPECTED to disagree (testkit always says "deny" for a substituted
 * literal; this policy correctly resolves "allow" for a genuine in-worktree
 * path) — this is the intended, correct behavior of the real engine
 * (probed live only by the `@live` suite this package owes, per README
 * decision 6), not a bug in either module. The fast-check property test in
 * `adjudication-policy.test.ts` therefore deliberately EXCLUDES the
 * `//`-anchored rule family from its cross-model comparison and instead
 * covers it with dedicated example tests asserting the "strip the leading
 * extra `/`" anchor-caveat behavior directly (see `resolveComparisonBucket`
 * below). Every OTHER rule family (bare tool name incl. `Agent`/`Task`
 * aliasing, `Bash(<prefix>:*)` incl. compound/wrapper smuggling, `~/`- and
 * bare-`/`-anchored path rules, `mcp__*` wildcards) is fully comparable and
 * IS included in the property test.
 *
 * A second, narrower documented divergence: this worker's own brief
 * paraphrases the process-wrapper list as "nohup/env"; `@eo/testkit`'s
 * actual `bash-command-matching.ts` reference strips exactly `{nohup, nice,
 * timeout}` — no `env` stripping exists in that reference implementation
 * (its own doc comment cites only `nohup`/`timeout`/`nice` as the baseline
 * §3-adjacent wrapper forms it was built against). Since this module's
 * explicit obligation is verdict AGREEMENT with that reference oracle
 * (fast-check property test), this module mirrors testkit's actual
 * `{nohup, nice, timeout}` set byte-for-byte rather than the brief's
 * paraphrase, and does not strip a leading `env`. Flagged in
 * `docs/evidence/phase-06/wi3-adjudication-result.md` for reconciliation.
 *
 * A THIRD documented divergence (Finding 3, deliberate — a hardening this
 * policy applies that the reference oracle does not): `@eo/testkit`'s
 * `matchesAnchoredGlobLiteral` widens a `~/`-anchored rule against a
 * bare-absolute target SYMMETRICALLY (allow and deny alike). This policy
 * widens DENY-ONLY: a `~/`-anchored ALLOW rule vs. an absolute target is NO
 * match, because the segment-window widening is a safe false-DENY for a
 * deny rule but would be a false-ALLOW for an allow rule (e.g. allow
 * `Read(~/.config/**)` must not match `/tmp/.config/evil`). The compiler
 * only emits `~/` in deny position today, but this independent backstop
 * must not assume that. The property test excludes exactly this one family
 * from its cross-model comparison and covers it with dedicated example
 * tests; see `absoluteTargetContainsHomeSuffix` below.
 */
import type { AdjudicationPolicy } from "@eo/supervisor";
import type { PermissionProfile } from "@eo/engine-core";
import { posix } from "node:path";

/**
 * Thrown at CONSTRUCTION time (never at call time) when a rule string does
 * not parse against any of the four supported grammars — fail-fast, per
 * this repo's "never a silently-ignored rule" ground rule (a malformed
 * rule that were silently skipped could quietly widen or narrow the
 * effective policy without anyone noticing).
 */
export class UnparseableRuleError extends Error {
  constructor(rule: string) {
    super(`envelope adjudication policy: rule does not parse against any known grammar: "${rule}"`);
    this.name = "UnparseableRuleError";
  }
}

export interface EnvelopeAdjudicationPolicyInput {
  /**
   * ALREADY placeholder-substituted (absolute paths) — see this file's
   * top-of-file precondition doc comment. Only `allow`/`deny` are read;
   * `ask`/`defaultMode`/`disableBypassPermissionsMode` are compiler-side
   * concerns this policy does not need.
   */
  readonly permissions: PermissionProfile;
}

// ---------------------------------------------------------------------------
// Bash command decomposition + prefix matching (docs/engine-baseline.md §3:
// compound-command / process-wrapper smuggling denied because the smuggled
// subcommand independently fails to match any allow-listed prefix).
// ---------------------------------------------------------------------------

const COMPOUND_SPLIT_PATTERN = /\s*(?:&&|\|\||;|\|)\s*/;

function splitCompoundCommand(command: string): readonly string[] {
  return command
    .split(COMPOUND_SPLIT_PATTERN)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/** Mirrors `@eo/testkit`'s `bash-command-matching.ts` reference set exactly — see file-level "second divergence" note above re: no `env` stripping. */
const WRAPPER_TOKENS: ReadonlySet<string> = new Set(["nohup", "nice", "timeout"]);
const MAX_WRAPPER_STRIP_ITERATIONS = 5;

function stripProcessWrapper(segment: string): string {
  let current = segment.trim();
  for (let i = 0; i < MAX_WRAPPER_STRIP_ITERATIONS; i += 1) {
    const tokens = current.split(/\s+/);
    const head = tokens[0];
    if (head === undefined || !WRAPPER_TOKENS.has(head)) {
      break;
    }
    const rest = tokens.slice(1);
    if (head === "timeout") {
      rest.shift(); // drop the wrapper's own duration argument (e.g. "10", "10s")
    }
    current = rest.join(" ").trim();
    if (current.length === 0) {
      break;
    }
  }
  return current;
}

function decomposeBashCommand(command: string): readonly string[] {
  return splitCompoundCommand(command).map(stripProcessWrapper);
}

const BASH_PREFIX_RULE_PATTERN = /^Bash\((.+):\*\)$/;

function matchesBashPrefixRule(rule: string, strippedSegment: string): boolean {
  const match = BASH_PREFIX_RULE_PATTERN.exec(rule);
  const prefix = match?.[1];
  if (prefix === undefined) {
    return false;
  }
  return strippedSegment === prefix || strippedSegment.startsWith(`${prefix} `);
}

/**
 * Unproven shell metacharacters (background `&`, command/parameter
 * substitution `$(...)`/`` ` ``/`${...}`, redirects `<`/`>`, embedded
 * newlines/carriage returns) — docs/engine-baseline.md §3 only ever probed
 * `&&`/`||`/`;`/`|` (compound operators) and `nohup`/`nice`/`timeout`
 * (process wrappers). This worker's brief additionally requires embedded
 * NEWLINE smuggling to never bypass detection; rather than treating
 * newline as a fifth compound-split delimiter (which `@eo/testkit`'s
 * reference does not do either), a segment carrying one of these
 * unproven characters is treated as an unmatchable smuggling attempt
 * outright — fail-closed on anything the baseline never probed, exactly
 * mirroring `@eo/testkit`'s own documented posture (and therefore staying
 * in verdict-agreement with it).
 */
const UNPROVEN_SHELL_METACHARACTER_PATTERN = /[&$`<>]|\r|\n/;

function containsUnprovenShellMetacharacter(segment: string): boolean {
  return UNPROVEN_SHELL_METACHARACTER_PATTERN.test(segment);
}

function bashCommandMatchesEveryRule(rules: readonly string[], command: string): boolean {
  const segments = decomposeBashCommand(command);
  if (segments.length === 0) {
    return false;
  }
  if (segments.some((segment) => containsUnprovenShellMetacharacter(segment))) {
    return false;
  }
  return segments.every((segment) => rules.some((rule) => matchesBashPrefixRule(rule, segment)));
}

function bashCommandMatchesAnyRule(rules: readonly string[], command: string): boolean {
  return decomposeBashCommand(command).some((segment) =>
    rules.some((rule) => matchesBashPrefixRule(rule, segment)),
  );
}

// ---------------------------------------------------------------------------
// Tool-name matching, incl. the `Agent`/`Task` alias (docs/engine-
// baseline.md §4.1: "the `Agent` rule name maps to the `Task` tool
// literal"; §4.2: deny enforcement is fail-closed catalog-removal — this
// policy is a call-time backstop of that same intent, not a replacement for
// the engine's own catalog-removal).
// ---------------------------------------------------------------------------

const TOOL_NAME_ALIASES: Readonly<Record<string, string>> = { Agent: "Task", Task: "Agent" };

function toolNameRuleMatches(rule: string, toolName: string): boolean {
  return rule === toolName || TOOL_NAME_ALIASES[rule] === toolName;
}

const BARE_TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// `mcp__<server>__*` wildcard matching (interface-ledger Gap 11).
// ---------------------------------------------------------------------------

const MCP_SCOPED_RULE_PATTERN = /^mcp__(.+)__\*$/;

function mcpRuleMatches(rule: string, toolName: string): boolean {
  if (rule === "mcp__*") {
    return true;
  }
  const match = MCP_SCOPED_RULE_PATTERN.exec(rule);
  const server = match?.[1];
  return server !== undefined && toolName.startsWith(`mcp__${server}__`);
}

// ---------------------------------------------------------------------------
// Path rule matching: `Edit|Write|Read(<glob>)`, glob always `/**`-suffixed.
// Three anchor forms (docs/engine-baseline.md §3; engine-core's own
// `//`/`~/`/bare-`/` convention): `//` (filesystem-root anchor — owned-path
// allow rules, ALREADY substituted with the real absolute worktree path by
// the time this policy sees them), `~/` (home-relative — mandatory
// credential-path denies), bare `/` (filesystem-absolute).
// ---------------------------------------------------------------------------

type PathAnchor = "//" | "~/" | "/" | "relative";

interface AnchoredPath {
  readonly anchor: PathAnchor;
  readonly base: string;
}

function classifyAnchoredPath(raw: string): AnchoredPath {
  if (raw.startsWith("//")) {
    return { anchor: "//", base: raw.slice(2) };
  }
  if (raw.startsWith("~/")) {
    return { anchor: "~/", base: raw.slice(2) };
  }
  if (raw.startsWith("/")) {
    return { anchor: "/", base: raw.slice(1) };
  }
  return { anchor: "relative", base: raw };
}

type ComparisonBucket = "absolute" | "home" | "worktree";

/**
 * THE ANCHOR CAVEAT (docs/engine-baseline.md §3; this worker's brief:
 * "`//`-anchored form from engine-core: strip the leading extra `/` when
 * comparing"). After spawn-time substitution, a compiled owned-path rule
 * `Edit(//<worktree>/pkg/**)` becomes `Edit(///abs/worktree/pkg/**)` — THREE
 * leading slashes: two from the `//` anchor, one from the substituted
 * absolute path's own leading slash. `classifyAnchoredPath` strips only the
 * two-character `//` anchor, leaving a base that STILL carries that one
 * extra leading slash (`/abs/worktree/pkg`). A real absolute target path
 * from an actual tool call (e.g. `file_path: "/abs/worktree/pkg/x.ts"`)
 * carries exactly one leading slash too, but arrives un-anchored (bare
 * `/`), whose own `classifyAnchoredPath` branch strips it via
 * `raw.slice(1)`. Left unreconciled, the rule's base and the target's base
 * would sit in namespaces one slash apart and NEVER match. This function is
 * the fix: for a `//`-anchored rule whose base itself still starts with
 * `/` (i.e., a real substituted absolute path, not a bare worktree-relative
 * literal), it strips that ONE extra leading slash too, landing the rule in
 * the SAME "absolute, no leading slash" bucket a bare `/`-anchored rule or
 * target path lands in.
 */
function resolveComparisonBucket(path: AnchoredPath): {
  readonly bucket: ComparisonBucket;
  readonly base: string;
} {
  if (path.anchor === "//") {
    if (path.base.startsWith("/")) {
      return { bucket: "absolute", base: path.base.slice(1) };
    }
    return { bucket: "worktree", base: path.base };
  }
  if (path.anchor === "~/") {
    return { bucket: "home", base: path.base };
  }
  if (path.anchor === "/") {
    return { bucket: "absolute", base: path.base };
  }
  return { bucket: "worktree", base: path.base };
}

function normalizeRulePath(raw: string): string {
  const normalized = posix.normalize(raw);
  if (normalized === ".") {
    return "";
  }
  return normalized.replace(/\/+$/, "");
}

function pathIsContainedIn(base: string, target: string): boolean {
  const normBase = normalizeRulePath(base);
  const normTarget = normalizeRulePath(target);
  if (normTarget === ".." || normTarget.startsWith("../")) {
    return false; // traversal escaped past the root — never contained
  }
  if (normBase === "") {
    return true;
  }
  return normTarget === normBase || normTarget.startsWith(`${normBase}/`);
}

/** Whether a rule is being matched in ALLOW or DENY position — the home-suffix widening below is applied ONLY in DENY context (Finding 3). */
type RuleContext = "allow" | "deny";

/**
 * Asymmetric widening (mirrors `@eo/testkit`'s own documented F5
 * hardening): this policy has no independent access to the real `$HOME` at
 * construction time (only `permissions` is given, per this file's own
 * precondition) — a `~/`-anchored DENY rule must still catch a
 * bare-absolute target path that happens to contain the same home-relative
 * suffix somewhere in its segments.
 *
 * DENY-ONLY (Finding 3): this widening is sound ONLY for deny rules, where
 * over-matching a segment window anywhere in the path is a safe false-DENY
 * (over-blocking). Applied to an ALLOW rule it would be a false-ALLOW — e.g.
 * allow `Read(~/.config/**)` would otherwise match `/tmp/.config/evil`
 * merely because both carry a `.config` segment. `matchesAnchoredGlob`
 * therefore only reaches this in DENY context; in ALLOW context a
 * home-bucket rule vs. an absolute target is simply NO match. The engine's
 * own compiler currently emits `~/` only in deny position, but this policy
 * is an INDEPENDENT defense-in-depth backstop (docs/engine-baseline.md §3 —
 * never the sole enforcement layer) and must not assume the compiler's
 * shape.
 */
function absoluteTargetContainsHomeSuffix(homeBase: string, absoluteTargetBase: string): boolean {
  const normHome = normalizeRulePath(homeBase);
  if (normHome === "") {
    return false;
  }
  const homeSegments = normHome.split("/");
  const targetSegments = normalizeRulePath(absoluteTargetBase).split("/");
  for (let start = 0; start + homeSegments.length <= targetSegments.length; start += 1) {
    const window = targetSegments.slice(start, start + homeSegments.length);
    if (window.join("/") === normHome) {
      return true;
    }
  }
  return false;
}

function matchesAnchoredGlob(
  globLiteral: string,
  targetPath: string,
  context: RuleContext,
): boolean {
  if (!globLiteral.endsWith("/**")) {
    return false;
  }
  const rule = resolveComparisonBucket(classifyAnchoredPath(globLiteral.slice(0, -3)));
  const target = resolveComparisonBucket(classifyAnchoredPath(targetPath));
  if (rule.bucket === target.bucket) {
    return pathIsContainedIn(rule.base, target.base);
  }
  if (rule.bucket === "home" && target.bucket === "absolute") {
    // Home-suffix widening is a sound false-DENY only in DENY context; in
    // ALLOW context it would be a false-ALLOW (Finding 3), so a home-bucket
    // allow rule vs. an absolute target is NO match.
    return context === "deny" && absoluteTargetContainsHomeSuffix(rule.base, target.base);
  }
  return false;
}

const PATH_RULE_PATTERN = /^(Edit|Write|Read)\((.+)\)$/;

function matchesToolPathRule(
  rule: string,
  tool: "Edit" | "Write" | "Read",
  targetPath: string,
  context: RuleContext,
): boolean {
  const match = PATH_RULE_PATTERN.exec(rule);
  const ruleTool = match?.[1];
  const globLiteral = match?.[2];
  if (ruleTool === undefined || globLiteral === undefined || ruleTool !== tool) {
    return false;
  }
  return matchesAnchoredGlob(globLiteral, targetPath, context);
}

// ---------------------------------------------------------------------------
// Construction-time rule-grammar validation (fail-fast).
// ---------------------------------------------------------------------------

function isParseableRule(rule: string): boolean {
  if (rule === "mcp__*" || MCP_SCOPED_RULE_PATTERN.test(rule)) {
    return true;
  }
  if (BASH_PREFIX_RULE_PATTERN.test(rule)) {
    return true;
  }
  const pathMatch = PATH_RULE_PATTERN.exec(rule);
  if (pathMatch?.[2] !== undefined && pathMatch[2].endsWith("/**")) {
    return true;
  }
  return BARE_TOOL_NAME_PATTERN.test(rule);
}

function assertRuleParses(rule: string): void {
  if (!isParseableRule(rule)) {
    throw new UnparseableRuleError(rule);
  }
}

// ---------------------------------------------------------------------------
// Per-tool-call evaluation, branching by category exactly like the engine's
// own tool-scoped rule application (and like `@eo/testkit`'s reference
// evaluator, for the categories where the two are comparable — see
// file-level divergence note).
// ---------------------------------------------------------------------------

function bashCommandOf(toolInput: Readonly<Record<string, unknown>>): string {
  return typeof toolInput.command === "string" ? toolInput.command : "";
}

function pathOf(toolInput: Readonly<Record<string, unknown>>): string {
  return typeof toolInput.file_path === "string" ? toolInput.file_path : "";
}

function evaluateToolCall(
  allow: readonly string[],
  deny: readonly string[],
  toolName: string,
  toolInput: Readonly<Record<string, unknown>>,
): "allow" | "deny" {
  if (toolName === "Bash") {
    const command = bashCommandOf(toolInput);
    if (bashCommandMatchesAnyRule(deny, command)) {
      return "deny";
    }
    return bashCommandMatchesEveryRule(allow, command) ? "allow" : "deny";
  }

  if (toolName === "Edit" || toolName === "Write" || toolName === "Read") {
    const path = pathOf(toolInput);
    if (deny.some((rule) => matchesToolPathRule(rule, toolName, path, "deny"))) {
      return "deny";
    }
    return allow.some((rule) => matchesToolPathRule(rule, toolName, path, "allow"))
      ? "allow"
      : "deny";
  }

  if (toolName.startsWith("mcp__")) {
    if (deny.some((rule) => mcpRuleMatches(rule, toolName))) {
      return "deny";
    }
    return allow.some((rule) => mcpRuleMatches(rule, toolName)) ? "allow" : "deny";
  }

  if (deny.some((rule) => toolNameRuleMatches(rule, toolName))) {
    return "deny";
  }
  return allow.some((rule) => toolNameRuleMatches(rule, toolName)) ? "allow" : "deny";
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Builds the real `AdjudicationPolicy` `createAdjudicationBus` (05,
 * `@eo/supervisor`) wraps. See this file's top-of-file doc comment for the
 * full semantics, the placeholder-substitution precondition, and the
 * documented `@eo/testkit` reference-model divergence.
 */
export function createEnvelopeAdjudicationPolicy(
  input: EnvelopeAdjudicationPolicyInput,
): AdjudicationPolicy {
  const { allow, deny } = input.permissions;

  // Construction-time validation (fail-fast, never a silently-ignored
  // rule): every rule must parse against one of the four supported
  // grammars before this policy is ever handed a real tool call.
  for (const rule of [...allow, ...deny]) {
    assertRuleParses(rule);
  }

  return async (toolName, toolInput, _context) => {
    try {
      const verdict = evaluateToolCall(allow, deny, toolName, toolInput);
      if (verdict === "allow") {
        return { behavior: "allow", updatedInput: toolInput };
      }
      return {
        behavior: "deny",
        message: `envelope policy denies "${toolName}" (no matching allow rule, or an explicit deny rule matched)`,
      };
    } catch (err) {
      // Fail-closed (roadmap/06 work item 3; mirrors `createAdjudicationBus`'s
      // own identical posture): a runtime evaluation failure of any kind is
      // indistinguishable from an attacker's tool call at this boundary.
      return {
        behavior: "deny",
        message: `envelope policy evaluation failed for "${toolName}" (${toErrorMessage(err)}) — failing closed`,
      };
    }
  };
}
