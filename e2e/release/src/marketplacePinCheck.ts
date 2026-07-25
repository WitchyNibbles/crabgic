import { MarketplaceSchema, readMarketplaceJson } from "@eo/plugin";
import { realGitCommitResolver, type GitCommitResolver } from "./gitCommitResolver.js";

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
 *      `@eo/plugin`'s `NULL_GIT_OBJECT_ID` refinement means genuinely
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
  /** Quotable release-blocking reasons — empty iff the clause is genuinely met. */
  readonly reasons: readonly string[];
}

export interface CheckMarketplacePinOptions {
  /** Absolute path to `packages/plugin`. */
  readonly pluginRoot: string;
  readonly repoRoot: string;
  readonly releaseCandidateObjectId: string;
  readonly resolveCommit?: GitCommitResolver;
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

  const matchesReleaseCandidate = resolved === options.releaseCandidateObjectId;
  return {
    readable: true,
    pinned: true,
    commit,
    resolvesInRepo: true,
    matchesReleaseCandidate,
    reasons: matchesReleaseCandidate
      ? []
      : [
          `the committed marketplace entry pins commit ${resolved}, not the release candidate ` +
            `${options.releaseCandidateObjectId} — the entry was not cut AT the release commit.`,
        ],
  };
}
