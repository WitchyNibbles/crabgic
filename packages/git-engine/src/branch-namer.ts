/**
 * Branch namer — roadmap/08-integration-publication.md work item 3:
 * "`<type>/[JIRA-KEY-]<short-slug>`; types feat/fix/perf/refactor/security/
 * test/docs/ci/chore; ≤64 chars; numeric collision suffix; no engine/
 * worker/run identifiers; git-ref charset/length legality enforced by
 * construction, then passed through 17's `renderWithRegeneration()` for the
 * `branch_name` `ArtifactKind`." Failing-first: "a seeded slug containing
 * an attribution token must be blocked by 17's lint before any
 * git-ref-legality concern is even reached."
 *
 * TWO-LAYER DESIGN: `buildBranchNameCandidate` (pure, no I/O, fast-check-
 * friendly) constructs a candidate that is git-ref-legal AND ≤64 chars BY
 * CONSTRUCTION — charset restricted to `[a-z0-9/-]`, length always fits,
 * collision suffix always monotonic. `nameBranch` then takes that
 * construction-legal candidate and STILL runs it through 17's
 * `renderWithRegeneration()` (the `branch_name` `ArtifactKind`) — this is
 * deliberately not redundant: the roadmap's failing-first case is exactly a
 * candidate that is charset/length-legal (a real, spellable slug) but
 * carries an attribution token as ordinary text (e.g. a slug derived from a
 * change-set title literally containing "co-authored-by") — legality and
 * neutral-language are orthogonal concerns, and only the SECOND one is 17's
 * to enforce.
 */

import { DEFAULT_COMMUNICATION_POLICY, type CommunicationPolicy } from "@eo/contracts";
import type { LintFinding } from "@eo/renderer";
import { renderWithRegeneration } from "@eo/renderer";

/** `<type>` — the closed set roadmap/08 names verbatim, reused identically for the commit-subject/PR-title `type(scope): outcome` convention (`./commit-renderer.ts`). */
export const BRANCH_TYPES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "security",
  "test",
  "docs",
  "ci",
  "chore",
] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];

export function isBranchType(value: unknown): value is BranchType {
  return typeof value === "string" && (BRANCH_TYPES as readonly string[]).includes(value);
}

export const MAX_BRANCH_NAME_LENGTH = 64;

/** Reserved headroom for a `-<n>` collision suffix — see `appendCollisionSuffix` below. */
const COLLISION_SUFFIX_RESERVE = 4;

/**
 * Whole-candidate legality re-check (defense-in-depth): every character
 * must be in the construction-time charset, no leading/trailing/doubled
 * `-` around the `/` separator, no `..`, never starts/ends with `/` or
 * `-`. Uppercase letters ARE permitted here (unlike `slugify`'s own
 * lowercase-only output) solely because a validated JIRA key is embedded
 * verbatim-uppercased (e.g. `ABC-123`) — git ref segments themselves are
 * case-sensitive with no case restriction of their own.
 */
const BRANCH_NAME_LEGAL_PATTERN = /^[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*$/;

export class InvalidBranchTypeError extends Error {
  constructor(value: string) {
    super(`branch-namer: "${value}" is not one of the ${BRANCH_TYPES.length} closed branch types`);
    this.name = "InvalidBranchTypeError";
  }
}

/** Slugifies free text into a lowercase, hyphen-separated, `[a-z0-9-]`-only token. Never empty: an all-non-alphanumeric input falls back to `"change"`. */
export function slugify(sourceText: string): string {
  const slug = sourceText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : "change";
}

function truncateSlug(slug: string, maxLength: number): string {
  const truncated = slug.slice(0, Math.max(maxLength, 0)).replace(/-+$/g, "");
  return truncated.length > 0 ? truncated : "x";
}

/** Appends `suffix` to `${prefix}${slug}`, trimming `slug` ONLY if the combined length would exceed `MAX_BRANCH_NAME_LENGTH` — a short slug's suffix form is never gratuitously shortened just because a suffix exists. */
function withSuffix(prefix: string, slug: string, suffix: string): string {
  const combinedLength = prefix.length + slug.length + suffix.length;
  if (combinedLength <= MAX_BRANCH_NAME_LENGTH) {
    return `${prefix}${slug}${suffix}`;
  }
  const allowedSlugLength = Math.max(MAX_BRANCH_NAME_LENGTH - prefix.length - suffix.length, 1);
  return `${prefix}${truncateSlug(slug, allowedSlugLength)}${suffix}`;
}

export interface BuildBranchNameInput {
  readonly type: BranchType;
  /** e.g. `"ABC-123"` — uppercased/validated as `[A-Za-z0-9]+-[A-Za-z0-9]+`; embedded as `<JIRA-KEY>-` immediately before the slug. */
  readonly jiraKey?: string;
  /** Free text to slugify (e.g. the owning `ChangeSet`/`Requirement`'s own title/outcome) — never itself required to already be ref-legal. */
  readonly slugSource: string;
  /** Already-used branch names to avoid colliding with (this phase's own project-scoped registry, caller-supplied) — default `[]`. */
  readonly existingBranchNames?: readonly string[];
}

const JIRA_KEY_PATTERN = /^[A-Za-z0-9]+-[A-Za-z0-9]+$/;

/**
 * Pure construction: charset-legal and ≤64 chars BY CONSTRUCTION, always —
 * property-tested in `./branch-namer.property.test.ts`. Appends a monotonic
 * numeric collision suffix (`-2`, `-3`, ...) when the unsuffixed candidate
 * already appears in `existingBranchNames`, trimming the slug further if
 * needed so the SUFFIXED form still fits ≤64.
 */
export function buildBranchNameCandidate(input: BuildBranchNameInput): string {
  if (!isBranchType(input.type)) {
    throw new InvalidBranchTypeError(input.type);
  }
  const jiraPrefix =
    input.jiraKey !== undefined && JIRA_KEY_PATTERN.test(input.jiraKey)
      ? `${input.jiraKey.toUpperCase()}-`
      : "";

  const prefix = `${input.type}/${jiraPrefix}`;
  const rawSlug = slugify(input.slugSource);
  const availableForSlug = Math.max(
    MAX_BRANCH_NAME_LENGTH - prefix.length - COLLISION_SUFFIX_RESERVE,
    1,
  );
  const slug = truncateSlug(rawSlug, availableForSlug);

  const existing = new Set(input.existingBranchNames ?? []);
  let candidate = `${prefix}${slug}`;
  let suffixIndex = 2;
  while (existing.has(candidate)) {
    candidate = withSuffix(prefix, slug, `-${String(suffixIndex)}`);
    suffixIndex += 1;
  }

  if (candidate.length > MAX_BRANCH_NAME_LENGTH || !BRANCH_NAME_LEGAL_PATTERN.test(candidate)) {
    // Unreachable under normal inputs (construction above already enforces
    // both invariants) — a defensive, documented failure mode rather than a
    // silently-illegal branch name ever escaping this function.
    throw new Error(
      `branch-namer: constructed candidate is not legal by construction: "${candidate}"`,
    );
  }
  return candidate;
}

export type NameBranchResult =
  | { readonly status: "named"; readonly branchName: string }
  | {
      readonly status: "blocked";
      readonly error: "policy_blocked";
      readonly findings: readonly LintFinding[];
    };

/**
 * `nameBranch` — builds a construction-legal candidate via
 * `buildBranchNameCandidate`, then routes it through 17's
 * `renderWithRegeneration()` for the `branch_name` `ArtifactKind` (roadmap
 * §Interfaces produced). On a second lint failure (e.g. the slug source
 * text itself carried an attribution token neither `generate` call could
 * shake), returns `policy_blocked` — this phase's conflict/CAS-failure
 * paths converge on the same `blocked` terminal (roadmap §Interfaces
 * consumed).
 */
export async function nameBranch(
  input: BuildBranchNameInput,
  policy: CommunicationPolicy = DEFAULT_COMMUNICATION_POLICY,
): Promise<NameBranchResult> {
  const outcome = await renderWithRegeneration({
    kind: "branch_name",
    policy,
    generate: () => buildBranchNameCandidate(input),
  });

  if (outcome.status === "blocked") {
    return { status: "blocked", error: "policy_blocked", findings: outcome.findings };
  }
  return { status: "named", branchName: outcome.artifact.content };
}
