import { posix } from "node:path";
import { WORKTREE_WRITE_PLACEHOLDER } from "@eo/engine-core";

/**
 * Anchored-glob path matching for `Edit`/`Write`/`Read` permission rules
 * and sandbox `denyRead` literals (roadmap/03-envelope-compiler-engine-
 * adapter.md §In scope "Fake engine" bullet: "Edit/Write path matching
 * over //-anchored globs"; work item 6: "path escape (`../` and
 * absolute)"). Three anchor forms mirror `@eo/engine-core`'s own compiled
 * literals: `//` (filesystem-root anchor, adaptation §4.1 — the compiled
 * profile spells owned-path allow rules `Edit(//<worktree>/${relpath}/**)`,
 * see CRITICAL 1's fix in `@eo/engine-core`'s `permission-profile.ts`),
 * `~/` (home-relative, `Read(~/.ssh/**)`), and bare `/`
 * (filesystem-absolute).
 *
 * CORRECTED MODEL (phase-03 security-fix round, CRITICAL 1 follow-through
 * — this doc comment previously said "`//` = worktree-relative", which was
 * itself part of the defect: it silently redefined `//` as the OPPOSITE
 * partition from the real engine's filesystem-root anchor, making every
 * escape invisible to this fake's own tests). This fake still cannot know
 * the real absolute worktree path at test time (no phase-06/07 spawn-time
 * substitution happens here), so it resolves a `//`-anchored base that
 * starts with the SAME `WORKTREE_WRITE_PLACEHOLDER` token the compiler
 * emits by stripping that token specifically — not any arbitrary base —
 * and matching the remainder in the same namespace as a bare (no-anchor)
 * target path. This is a deliberate, documented fake-fidelity
 * simplification (mirrors `@eo/engine-core`'s own placeholder-token
 * convention, `../../README.md`): it only ever resolves the ONE known
 * placeholder token, so it cannot be tricked into treating an arbitrary
 * `//`-anchored literal (e.g. a raw, unvalidated `//etc/cron.d/**`) as
 * worktree-relative — such a literal now simply fails to match anything,
 * which is the fail-closed direction.
 */
type PathAnchor = "//" | "~/" | "/";

interface AnchoredPath {
  readonly anchor: PathAnchor;
  readonly base: string;
}

const WORKTREE_PLACEHOLDER_PREFIX = `${WORKTREE_WRITE_PLACEHOLDER}/`;

/** Strips the compiler's `<worktree>` placeholder token from a `//`-anchored base, if present. */
function resolveWorktreePlaceholder(base: string): string {
  if (base === WORKTREE_WRITE_PLACEHOLDER) {
    return "";
  }
  if (base.startsWith(WORKTREE_PLACEHOLDER_PREFIX)) {
    return base.slice(WORKTREE_PLACEHOLDER_PREFIX.length);
  }
  return base;
}

function classifyAnchoredString(raw: string): AnchoredPath {
  if (raw.startsWith("//")) {
    return { anchor: "//", base: resolveWorktreePlaceholder(raw.slice(2)) };
  }
  if (raw.startsWith("~/")) {
    return { anchor: "~/", base: raw.slice(2) };
  }
  if (raw.startsWith("/")) {
    return { anchor: "/", base: raw.slice(1) };
  }
  // A plain relative string (no anchor prefix at all) is treated as
  // worktree-relative — the same namespace as the resolved "//" anchor.
  return { anchor: "//", base: raw };
}

/** Lexically normalizes (no filesystem access) — resolves `.`/`..` segments and trailing slashes. */
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

/**
 * NOTE 5 / F5 hardening (phase-03 security-fix round): a bare-absolute
 * (`/`-anchored) target that lexically resolves under a known sensitive
 * suffix (e.g. `.ssh`, `.aws`) must still be caught by a `~/`-anchored
 * deny rule for that same suffix — even though this fake never performs
 * the real engine's home-directory resolution and would otherwise require
 * matching anchors. This is intentionally ASYMMETRIC: it only ever WIDENS
 * what a `~/`-anchored rule matches (an absolute-spelled read that would
 * otherwise slip past the anchor partition), never narrows it. Since
 * `@eo/engine-core` never emits a `~/`-anchored ALLOW rule (owned paths
 * always compile to `//<worktree>`-anchored allow — see CRITICAL 1's
 * fix), this widening can only ever produce a false-DENY (over-blocking)
 * in this system, never a false-ALLOW.
 *
 * A fully faithful home-directory-resolution model (actually resolving `~`
 * against a real `HOME` and comparing canonicalized absolute paths) is out
 * of this fake's scope — this is a documented, deliberately partial
 * fidelity limitation. See `path-matching.test.ts`'s "known fake-fidelity
 * limitation" cases for what it does and does not catch.
 */
function bareAbsoluteTargetContainsHomeAnchoredSuffix(
  homeBase: string,
  absoluteTargetBase: string,
): boolean {
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

/**
 * Matches a bare anchored-glob literal (e.g. `//packages/example/src/**`,
 * `~/.ssh/**`) against a target path string. Used both by permission-rule
 * path matching (after stripping the `Tool(...)` wrapper) and directly by
 * the sandbox layer's `filesystem.denyRead` literals.
 */
export function matchesAnchoredGlobLiteral(globLiteral: string, targetPath: string): boolean {
  if (!globLiteral.endsWith("/**")) {
    return false;
  }
  const ruleAnchored = classifyAnchoredString(globLiteral.slice(0, -3));
  const targetAnchored = classifyAnchoredString(targetPath);
  if (ruleAnchored.anchor === targetAnchored.anchor) {
    return pathIsContainedIn(ruleAnchored.base, targetAnchored.base);
  }
  // Cross-anchor hardening (F5): only ever widens '~/'-anchored rules
  // against bare-absolute targets — see doc comment above.
  if (ruleAnchored.anchor === "~/" && targetAnchored.anchor === "/") {
    return bareAbsoluteTargetContainsHomeAnchoredSuffix(ruleAnchored.base, targetAnchored.base);
  }
  return false;
}

const PATH_RULE_PATTERN = /^(Edit|Write|Read)\((.+)\)$/;

export function matchesToolPathRule(
  rule: string,
  tool: "Edit" | "Write" | "Read",
  targetPath: string,
): boolean {
  const match = PATH_RULE_PATTERN.exec(rule);
  const ruleTool = match?.[1];
  const globLiteral = match?.[2];
  if (ruleTool === undefined || globLiteral === undefined || ruleTool !== tool) {
    return false;
  }
  return matchesAnchoredGlobLiteral(globLiteral, targetPath);
}
