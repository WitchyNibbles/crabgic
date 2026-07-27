import { MarketplaceSchema, readMarketplaceJson } from "@crabgic/plugin";
import {
  realGitChangedPathsResolver,
  realGitCommitResolver,
  type GitChangedPathsResolver,
  type GitCommitResolver,
} from "./gitCommitResolver.js";

/**
 * Repo-relative paths that CANNOT affect what the plugin distributes, and
 * are therefore safe to differ between the pinned commit and the release
 * candidate. Exactly `packages/plugin/.claude-plugin/**` — the single entry
 * `@crabgic/plugin`'s `computeContentDigest` excludes from the packaged
 * file set, because it holds the `marketplace.json` that cites the digest.
 * Anything else, inside the plugin or out, is a real divergence.
 */
const DIGEST_EXCLUDED_PATH = /^packages\/plugin\/\.claude-plugin\//;

/**
 * "SHA-pinned marketplace entry cut at the release commit" — the clause of
 * roadmap/23-release-hardening.md's reproducible-build exit criterion
 * (`:136`) that was furthest from verified: the harness PREPARED an entry
 * in memory (`marketplaceEntryPreparer.ts`, which by design never writes)
 * and nothing ever inspected the COMMITTED
 * `packages/plugin/.claude-plugin/marketplace.json`.
 *
 * Three separate facts, each independently reportable:
 *   1. the committed file is readable and schema-valid, which since
 *      `@crabgic/plugin`'s `NULL_GIT_OBJECT_ID` refinement means genuinely
 *      SHA-pinned rather than "40 hex characters shaped like a pin";
 *   2. that pinned commit actually resolves to a commit in this
 *      repository; and
 *   3. it is the release candidate, not some other commit.
 *
 * Read-only: pinning the real entry is an owner release action.
 */

export interface MarketplacePinCheckResult {
  /** The committed `marketplace.json` could be read and JSON-parsed. */
  readonly readable: boolean;
  /** It is schema-valid per `MarketplaceSchema`, i.e. genuinely SHA-pinned (the all-zero placeholder is refused). */
  readonly pinned: boolean;
  readonly commit?: string;
  readonly resolvesInRepo: boolean;
  readonly matchesReleaseCandidate: boolean;
  /**
   * HOW the entry was matched, so a report can distinguish the two honest
   * cases from a failure: `"exact"` (the pin names the candidate itself),
   * `"digest-neutral-ancestor"` (it names an ancestor from which nothing the
   * plugin distributes has changed — the release-cut self-reference), or
   * `"mismatched"`. Absent when the entry never got as far as being compared.
   */
  readonly pinEquivalence?: "exact" | "digest-neutral-ancestor" | "mismatched";
  /** Quotable release-blocking reasons — empty iff the clause is genuinely met. */
  readonly reasons: readonly string[];
}

export interface CheckMarketplacePinOptions {
  /** Absolute path to `packages/plugin`. */
  readonly pluginRoot: string;
  readonly repoRoot: string;
  readonly releaseCandidateObjectId: string;
  readonly resolveCommit?: GitCommitResolver;
  readonly resolveChangedPaths?: GitChangedPathsResolver;
}

const UNMET = 'the exit criterion\'s "SHA-pinned marketplace entry cut at the release commit"';

export async function checkMarketplacePin(
  options: CheckMarketplacePinOptions,
): Promise<MarketplacePinCheckResult> {
  let raw: unknown;
  try {
    raw = readMarketplaceJson(options.pluginRoot);
  } catch (err) {
    return {
      readable: false,
      pinned: false,
      resolvesInRepo: false,
      matchesReleaseCandidate: false,
      reasons: [
        `the committed marketplace.json under ${options.pluginRoot} could not be read/parsed ` +
          `(${err instanceof Error ? err.message : String(err)}) — ${UNMET} clause is UNVERIFIABLE.`,
      ],
    };
  }

  // `safeParse`, never `parse`: a listing that is not yet pinned is an
  // ordinary release finding this gate must REPORT, not an exception that
  // aborts the run and turns an honest FAIL into a hard ERROR.
  const parsed = MarketplaceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      readable: true,
      pinned: false,
      resolvesInRepo: false,
      matchesReleaseCandidate: false,
      reasons: [
        `the committed marketplace.json is not SHA-pinned/schema-valid ` +
          `(${parsed.error.issues.map((issue) => issue.message).join("; ")}) — ${UNMET} clause is UNMET.`,
      ],
    };
  }

  // `MarketplaceSchema` enforces `plugins.length >= 1`, so having just
  // passed validation guarantees this entry exists.
  const commit = parsed.data.plugins[0]!.commit;
  const resolveCommit = options.resolveCommit ?? realGitCommitResolver;
  const resolved = await resolveCommit(options.repoRoot, commit);

  if (resolved === undefined) {
    return {
      readable: true,
      pinned: true,
      commit,
      resolvesInRepo: false,
      matchesReleaseCandidate: false,
      reasons: [
        `the committed marketplace entry pins commit ${commit}, which does not resolve to any ` +
          `commit in this repository — ${UNMET} clause is UNMET.`,
      ],
    };
  }

  if (resolved === options.releaseCandidateObjectId) {
    return {
      readable: true,
      pinned: true,
      commit,
      resolvesInRepo: true,
      matchesReleaseCandidate: true,
      pinEquivalence: "exact",
      reasons: [],
    };
  }

  // THE SELF-REFERENCE. Writing the pin CHANGES the commit, so the commit
  // that carries the pin can never be the commit the pin names: cutting a
  // release lands `chore(release): version packages for X` and then
  // `chore(release): pin the marketplace entry at the vX release commit`,
  // and the entry names the former while the candidate is the latter.
  // Under plain equality this clause was UNSATISFIABLE — every release this
  // project has cut (1.0.0 through 1.1.1) failed it for that reason alone.
  //
  // What the criterion actually wants is that the committed entry describes
  // WHAT IS BEING RELEASED. That is verifiable rather than assumable: the
  // pin commit must be an ancestor of the candidate, and everything that
  // changed between them must be confined to `.claude-plugin/` — the one
  // directory `computeContentDigest` EXCLUDES by design (it holds
  // `marketplace.json`, which cites the digest). A diff confined there
  // cannot alter a single byte the plugin distributes, so the entry
  // describes the candidate's plugin content exactly.
  //
  // This is deliberately NOT "accept any ancestor": a pin left at a previous
  // release still fails, because that range touches packaged files.
  const changedPaths = await (options.resolveChangedPaths ?? realGitChangedPathsResolver)(
    options.repoRoot,
    resolved,
    options.releaseCandidateObjectId,
  );
  const digestNeutral =
    changedPaths !== undefined &&
    changedPaths.length > 0 &&
    changedPaths.every((path) => DIGEST_EXCLUDED_PATH.test(path));

  if (digestNeutral) {
    return {
      readable: true,
      pinned: true,
      commit,
      resolvesInRepo: true,
      matchesReleaseCandidate: true,
      pinEquivalence: "digest-neutral-ancestor",
      reasons: [],
    };
  }

  return {
    readable: true,
    pinned: true,
    commit,
    resolvesInRepo: true,
    matchesReleaseCandidate: false,
    pinEquivalence: "mismatched",
    reasons: [
      `the committed marketplace entry pins commit ${resolved}, not the release candidate ` +
        `${options.releaseCandidateObjectId}, and the two differ in files that change what the ` +
        `plugin distributes ${describeDivergence(changedPaths)} — the entry was not cut AT the ` +
        `release commit.`,
    ],
  };
}

/** Renders the divergence between a pinned commit and the candidate for a release-blocking reason. */
function describeDivergence(changedPaths: readonly string[] | undefined): string {
  if (changedPaths === undefined) {
    return "(the pinned commit is not an ancestor of the candidate)";
  }
  if (changedPaths.length === 0) {
    return "(the two commits have identical trees, so the pin names an unrelated rewrite)";
  }
  const packaged = changedPaths.filter((path) => !DIGEST_EXCLUDED_PATH.test(path));
  const shown = packaged.slice(0, 3).join(", ");
  return `(e.g. ${shown}${packaged.length > 3 ? `, +${String(packaged.length - 3)} more` : ""})`;
}
