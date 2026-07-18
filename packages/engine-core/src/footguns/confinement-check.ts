import type { CompiledWorkerProfile } from "../compiler/compiled-worker-profile.js";
import { WORKTREE_WRITE_PLACEHOLDER } from "../compiler/worktree-placeholders.js";

/**
 * `isEditAllowed` — a minimal, INDEPENDENT anchored-glob confinement
 * matcher used only by `property.test.ts`'s semantic "no allow outside the
 * envelope" property (phase-03 security-fix round, MAJOR 3: the OLD
 * version of that property re-derived the exact string the compiler itself
 * emitted and checked equality against it — tautological, and unable to
 * detect a confinement escape by construction).
 *
 * This is deliberately NOT the compiler's own rule-emission code (that
 * would just be the same tautology one call deeper), and deliberately NOT
 * `@eo/testkit`'s fake-engine path matcher — this package must not depend
 * on `@eo/testkit` (see `../compiler/envelope-fixture.ts`'s own
 * seam-decision doc comment: a `@eo/testkit -> @eo/engine-core` edge
 * already exists, so the reverse would be circular). It mirrors the SAME
 * `//`/`~/`/bare anchor semantics `@eo/testkit`'s `path-matching.ts`
 * implements (including the shared `WORKTREE_WRITE_PLACEHOLDER`
 * resolution), kept honest by the fact that both this module and the
 * conformance-fixture set are exercised against the same compiled output.
 */
type Anchor = "//" | "~/" | "/";

interface AnchoredPath {
  readonly anchor: Anchor;
  readonly base: string;
}

const WORKTREE_PLACEHOLDER_PREFIX = `${WORKTREE_WRITE_PLACEHOLDER}/`;

function resolveWorktreePlaceholder(base: string): string {
  if (base === WORKTREE_WRITE_PLACEHOLDER) {
    return "";
  }
  if (base.startsWith(WORKTREE_PLACEHOLDER_PREFIX)) {
    return base.slice(WORKTREE_PLACEHOLDER_PREFIX.length);
  }
  return base;
}

function classify(raw: string): AnchoredPath {
  if (raw.startsWith("//")) {
    return { anchor: "//", base: resolveWorktreePlaceholder(raw.slice(2)) };
  }
  if (raw.startsWith("~/")) {
    return { anchor: "~/", base: raw.slice(2) };
  }
  if (raw.startsWith("/")) {
    return { anchor: "/", base: raw.slice(1) };
  }
  return { anchor: "//", base: raw };
}

/** Lexically normalizes (no filesystem access): resolves `.`/`..` segments; `".."` sentinel means "escaped past root". */
function normalize(raw: string): string {
  const segments = raw.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === "..") {
      if (stack.length === 0) {
        return "..";
      }
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack.join("/");
}

function contains(base: string, target: string): boolean {
  const normBase = normalize(base);
  const normTarget = normalize(target);
  if (normTarget === "..") {
    return false;
  }
  if (normBase === "") {
    return true;
  }
  return normTarget === normBase || normTarget.startsWith(`${normBase}/`);
}

function matchesPathRule(rule: string, tool: "Edit" | "Write", targetPath: string): boolean {
  const match = /^(Edit|Write)\((.+)\)$/.exec(rule);
  const ruleTool = match?.[1];
  const globLiteral = match?.[2];
  if (ruleTool === undefined || globLiteral === undefined || ruleTool !== tool) {
    return false;
  }
  if (!globLiteral.endsWith("/**")) {
    return false;
  }
  const ruleAnchored = classify(globLiteral.slice(0, -3));
  const targetAnchored = classify(targetPath);
  if (ruleAnchored.anchor !== targetAnchored.anchor) {
    return false;
  }
  return contains(ruleAnchored.base, targetAnchored.base);
}

/** Deny-wins Edit confinement check for a single target path against a compiled profile. */
export function isEditAllowed(profile: CompiledWorkerProfile, targetPath: string): boolean {
  const { allow, deny } = profile.permissions;
  if (deny.some((rule) => matchesPathRule(rule, "Edit", targetPath))) {
    return false;
  }
  return allow.some((rule) => matchesPathRule(rule, "Edit", targetPath));
}
