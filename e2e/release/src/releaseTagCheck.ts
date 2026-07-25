import { realGitCommitResolver, type GitCommitResolver } from "./gitCommitResolver.js";

/**
 * "`v1.0.0` tag created" — another clause of roadmap/23-release-hardening
 * .md's reproducible-build exit criterion (`:136`) that the gate asserted
 * while verifying nothing: `releaseTagScriptPreparer.ts` RENDERS a tag
 * script (never runs it, by the PREPARE-DON'T-PUBLISH owner decision), and
 * nothing ever asked git whether the tag exists.
 *
 * This check is read-only: it never creates, moves, or pushes a tag.
 * Cutting the real tag is an owner release action.
 */

export interface ReleaseTagCheckResult {
  readonly tagName: string;
  readonly exists: boolean;
  /** The commit the tag peels to, when it exists. */
  readonly resolvedCommit?: string;
  readonly pointsAtReleaseCandidate: boolean;
  /** Quotable release-blocking reasons — empty iff the clause is genuinely met. */
  readonly reasons: readonly string[];
}

export interface CheckReleaseTagOptions {
  readonly repoRoot: string;
  /** e.g. `"v1.0.0"`. */
  readonly tagName: string;
  /** The exact object id the release is being cut from — a tag pointing anywhere else does not evidence THIS candidate. */
  readonly releaseCandidateObjectId: string;
  readonly resolveCommit?: GitCommitResolver;
}

export async function checkReleaseTag(
  options: CheckReleaseTagOptions,
): Promise<ReleaseTagCheckResult> {
  const resolveCommit = options.resolveCommit ?? realGitCommitResolver;
  const resolvedCommit = await resolveCommit(options.repoRoot, `refs/tags/${options.tagName}`);

  if (resolvedCommit === undefined) {
    return {
      tagName: options.tagName,
      exists: false,
      pointsAtReleaseCandidate: false,
      reasons: [
        `no ${options.tagName} tag exists in this repository — the exit criterion's ` +
          `"${options.tagName} tag created" clause is UNMET. The harness only PREPARES the tag ` +
          `script; running it is an owner release action.`,
      ],
    };
  }

  const pointsAtReleaseCandidate = resolvedCommit === options.releaseCandidateObjectId;
  return {
    tagName: options.tagName,
    exists: true,
    resolvedCommit,
    pointsAtReleaseCandidate,
    reasons: pointsAtReleaseCandidate
      ? []
      : [
          `the ${options.tagName} tag points at ${resolvedCommit}, not at the release candidate ` +
            `${options.releaseCandidateObjectId} — the tag does not evidence THIS candidate.`,
        ],
  };
}
