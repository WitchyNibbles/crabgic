import { createHash } from "node:crypto";
import { join } from "node:path";
import type { JournalStore } from "@crabgic/journal";
import type { MarketplacePluginEntry } from "@crabgic/plugin";
import { GitArchiveExporter } from "./checkoutExporter.js";
import { RealPackRunner } from "./packRunner.js";
import {
  checkReproducibleBuild,
  type ReproducibleBuildCheckResult,
} from "./reproducibleBuildCheck.js";
import { REBUILD_CHECKOUTS_ENV_VAR, resolveBuildOutputPopulator } from "./rebuildPopulator.js";
import { checkEnginePinAcrossCheckouts, type EnginePinCheckResult } from "./enginePinCheck.js";
import {
  RealPublishRunner,
  runPublishDryRun,
  type PublishDryRunResult,
} from "./publishDryRunCheck.js";
import { prepareMarketplaceEntry } from "./marketplaceEntryPreparer.js";
import {
  draftChangelog,
  isPlaceholderChangelogDraft,
  readChangesetEntries,
} from "./changelogDraftPreparer.js";
import { prepareTagScript } from "./releaseTagScriptPreparer.js";
import { checkChangelogEntry, type ChangelogEntryCheckResult } from "./changelogEntryCheck.js";
import { checkReleaseTag, type ReleaseTagCheckResult } from "./releaseTagCheck.js";
import { checkMarketplacePin, type MarketplacePinCheckResult } from "./marketplacePinCheck.js";
import { checkNpmNameRecheck, type NpmNameRecheckResult } from "./npmNameRecheck.js";
import {
  checkPublication,
  RealNpmViewRunner,
  type PublicationCheckResult,
} from "./publicationCheck.js";
import { realGitCommitResolver } from "./gitCommitResolver.js";
import {
  emitReproducibleBuildEvidence,
  ENGINE_PIN_RECORDED_GATE_TAG,
  REPRODUCIBLE_BUILD_GATE_TAG,
} from "./evidence.js";

/**
 * The composed reproducible-build + publication-dry-run gate —
 * roadmap/23-release-hardening.md work item 10. Runs every real check this
 * project builds against the SAME `commitIsh` and folds them into one
 * verdict.
 *
 * The exit criterion (`roadmap/23-release-hardening.md:136`, restated
 * verbatim as `e2e/report/src/checklist.ts`'s `reproducible-build`
 * description) has SEVEN clauses. Naming them exactly, and saying for each
 * exactly what scores it — a completeness CLAIM is the thing this gate
 * exists to refuse, so the claim is enumerated rather than asserted:
 *
 * 1. "two independent from-clean-checkout builds … produce byte-identical
 *    tarball hashes" — DIRECTLY verified by `reproducibleBuildCheck.ts`.
 *    The "from-clean-checkout BUILD" half is only real under
 *    `CRABGIC_RELEASE_REBUILD_CHECKOUTS=1`; without it the gate emits a
 *    release-blocking reason saying so, rather than assuming it.
 * 2. "npm provenance attestation present" — PROXY-scored only. Nothing here
 *    produces or inspects a real attestation: `publishDryRunCheck.ts`
 *    checks the STATIC metadata prerequisites (`license`,
 *    `publishConfig.access`, `repository`) of a provenance-attested
 *    publish, over a `--dry-run` that never passes `--provenance` and today
 *    reports `skippedDueToPrivate`. A green here means "ready to attest",
 *    NOT "attested".
 * 3. "package published" — DIRECTLY verified by `publicationCheck.ts`,
 *    which asks the real registry. It fails CLOSED: no answer is a reason,
 *    never a pass. Publishing itself is an owner release action this gate
 *    never performs.
 * 4. "SHA-pinned marketplace entry cut at the release commit" — DIRECTLY
 *    verified by `marketplacePinCheck.ts` against the committed
 *    `marketplace.json`, plus a cross-check of the PREPARED entry.
 * 5. "`v1.0.0` tag created" — DIRECTLY verified by `releaseTagCheck.ts`
 *    against real git, plus a cross-check of the PREPARED tag script.
 * 6. "`CHANGELOG.md` entry present" — DIRECTLY verified by
 *    `changelogEntryCheck.ts`, plus a cross-check of the PREPARED draft.
 * 7. "`npm view crabgic` re-check passes" — RECORD-scored:
 *    `npmNameRecheck.ts` asserts a freshly timestamped verdict exists in
 *    `docs/release-notes-prep.md`, not that `npm view` ran just now.
 *
 * (The SDK pin is scored here too, but it belongs to the SEPARATE
 * `engine-pin-recorded` criterion, not to these seven — miscounting it as
 * one of them is how "package published" previously went unnoticed.)
 *
 * Clauses 4-7 were, before this round, asserted by the description and
 * verified by nothing; the marketplace entry, changelog draft and tag
 * script were computed and thrown away.
 *
 * PREPARE-DON'T-PUBLISH is unchanged: nothing here publishes, tags, or
 * mutates the marketplace — every check is strictly read-only (`npm view`
 * reads the registry and needs no credentials), and a clause the owner has
 * not performed yet reports as a release-blocking REASON rather than being
 * assumed.
 */
export interface ReleaseGateSummaryOptions {
  readonly repoRoot: string;
  readonly commitIsh: string;
  /** Relative to `repoRoot`, e.g. `"packages/cli"` — the published package. */
  readonly cliPackageSubPath: string;
  /** Relative to `repoRoot`, e.g. `"packages/engine-claude"` — declares the exact-pinned SDK dependency. */
  readonly enginePackageSubPath: string;
  /** Absolute path to `packages/plugin`. */
  readonly pluginRoot: string;
  /** The release version to prepare, e.g. `"1.0.0"`. */
  readonly version: string;
  /**
   * Which registry state the "package published" clause requires — see
   * `checkPublication`'s `expectation`. Defaults to `"publishable"` because
   * THIS summary IS the pre-publish gate: it runs before the publish it gates,
   * so it verifies the candidate CAN be published, not that it already has
   * been (the post-publish fact the publish job's own re-check confirms).
   * Requiring `"published"` here would deadlock the pipeline.
   */
  readonly publicationExpectation?: "published" | "publishable";
  /** Defaults to `process.env` — the seam `CRABGIC_RELEASE_REBUILD_CHECKOUTS` is read through. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ReleaseGateSummaryResult {
  readonly releaseCandidateObjectId: string;
  readonly reproducibleBuild: ReproducibleBuildCheckResult;
  readonly enginePin: EnginePinCheckResult;
  readonly publishDryRun: PublishDryRunResult;
  readonly marketplaceEntry: MarketplacePluginEntry;
  readonly changelogDraft: string;
  readonly tagScript: string;
  readonly changelog: ChangelogEntryCheckResult;
  readonly releaseTag: ReleaseTagCheckResult;
  readonly marketplacePin: MarketplacePinCheckResult;
  readonly npmNameRecheck: NpmNameRecheckResult;
  readonly publication: PublicationCheckResult;
  readonly verdict: "PASS" | "FAIL";
  readonly reasons: readonly string[];
}

/** The npm package name this release publishes — `packages/cli/package.json`'s own `"name"`, and the name `docs/release-notes-prep.md` records the availability verdict for. `releaseGateSummary.test.ts` asserts it still matches that manifest (freshness). */
export const PUBLISHED_PACKAGE_NAME = "crabgic";

/** Thrown when `commitIsh` names no commit — every other check is relative to that object id, so proceeding would compare nothing against nothing. */
export class UnresolvableCommitIshError extends Error {
  constructor(readonly commitIsh: string) {
    super(
      `release gate: commit-ish "${commitIsh}" resolves to no commit in this repository — the ` +
        "release-candidate object id every other check compares against cannot be determined.",
    );
    this.name = "UnresolvableCommitIshError";
  }
}

export async function runReleaseGateSummary(
  options: ReleaseGateSummaryOptions,
): Promise<ReleaseGateSummaryResult> {
  const env = options.env ?? process.env;
  const releaseCandidateObjectId = await realGitCommitResolver(options.repoRoot, options.commitIsh);
  if (releaseCandidateObjectId === undefined) {
    throw new UnresolvableCommitIshError(options.commitIsh);
  }

  const exporter = new GitArchiveExporter({ repoRoot: options.repoRoot });
  const packRunner = new RealPackRunner();
  const populateBuildOutput = resolveBuildOutputPopulator({
    repoRoot: options.repoRoot,
    packageSubPath: options.cliPackageSubPath,
    env,
  });
  const tagName = `v${options.version}`;

  const [
    reproducibleBuild,
    enginePin,
    publishDryRun,
    marketplaceEntry,
    releaseTag,
    marketplacePin,
  ] = await Promise.all([
    checkReproducibleBuild({
      exporter,
      packRunner,
      commitIsh: options.commitIsh,
      packageSubPath: options.cliPackageSubPath,
      populateBuildOutput,
    }),
    checkEnginePinAcrossCheckouts({
      exporter,
      commitIsh: options.commitIsh,
      enginePackageSubPath: options.enginePackageSubPath,
    }),
    runPublishDryRun({
      runner: new RealPublishRunner(),
      packageDir: join(options.repoRoot, options.cliPackageSubPath),
    }),
    prepareMarketplaceEntry({
      pluginRoot: options.pluginRoot,
      repoRoot: options.repoRoot,
      version: options.version,
      commitIsh: options.commitIsh,
    }),
    checkReleaseTag({ repoRoot: options.repoRoot, tagName, releaseCandidateObjectId }),
    checkMarketplacePin({
      pluginRoot: options.pluginRoot,
      repoRoot: options.repoRoot,
      releaseCandidateObjectId,
    }),
  ]);

  const changesetEntries = readChangesetEntries(join(options.repoRoot, ".changeset"));
  const changelogDraft = draftChangelog({ version: options.version, entries: changesetEntries });
  const tagScript = prepareTagScript({
    tagName,
    message: `Release ${tagName}`,
    commitIsh: options.commitIsh,
  });
  const changelog = checkChangelogEntry({
    repoRoot: options.repoRoot,
    version: options.version,
  });
  const npmNameRecheck = checkNpmNameRecheck({
    repoRoot: options.repoRoot,
    packageName: PUBLISHED_PACKAGE_NAME,
  });
  const publication = await checkPublication({
    packageJsonPath: join(options.repoRoot, options.cliPackageSubPath, "package.json"),
    packageName: PUBLISHED_PACKAGE_NAME,
    version: options.version,
    runner: new RealNpmViewRunner(),
    expectation: options.publicationExpectation ?? "publishable",
  });

  const { verdict, reasons } = computeReleaseGateVerdict({
    version: options.version,
    releaseCandidateObjectId,
    reproducibleBuild,
    enginePin,
    publishDryRun,
    marketplaceEntry,
    changelogDraft,
    tagScript,
    releaseArtifacts: { changelog, releaseTag, marketplacePin, npmNameRecheck, publication },
  });

  return {
    releaseCandidateObjectId,
    reproducibleBuild,
    enginePin,
    publishDryRun,
    marketplaceEntry,
    changelogDraft,
    tagScript,
    changelog,
    releaseTag,
    marketplacePin,
    npmNameRecheck,
    publication,
    verdict,
    reasons,
  };
}

/** Anything carrying its own quotable release-blocking reasons — every release-artifact check's result shape. */
interface HasReasons {
  readonly reasons: readonly string[];
}

export interface ReleaseGateVerdictInputs {
  readonly version: string;
  readonly releaseCandidateObjectId: string;
  readonly reproducibleBuild: Pick<
    ReproducibleBuildCheckResult,
    "comparison" | "rebuiltFromCleanCheckout"
  >;
  readonly enginePin: Pick<EnginePinCheckResult, "match" | "matchesBaseline" | "pinA" | "pinB">;
  readonly publishDryRun: Pick<PublishDryRunResult, "metadata">;
  readonly marketplaceEntry: Pick<MarketplacePluginEntry, "version" | "commit">;
  readonly changelogDraft: string;
  readonly tagScript: string;
  readonly releaseArtifacts: {
    readonly changelog: HasReasons;
    readonly releaseTag: HasReasons;
    readonly marketplacePin: HasReasons;
    readonly npmNameRecheck: HasReasons;
    /** "package published" — the clause that, before this round, was scored by nothing at all. */
    readonly publication: HasReasons;
  };
}

/** The tarball/build half of the criterion. */
function buildReasons(inputs: ReleaseGateVerdictInputs): readonly string[] {
  const reasons: string[] = [];
  if (!inputs.reproducibleBuild.comparison.match) {
    reasons.push(
      "two independent clean checkouts produced DIFFERENT tarball hashes — reproducible build FAILED.",
    );
  }
  if (!inputs.reproducibleBuild.rebuiltFromCleanCheckout) {
    reasons.push(
      "both checkouts were populated from the CURRENT, already-built dist/ rather than rebuilt " +
        'in place, so the criterion\'s own words — "two independent from-clean-checkout builds" — ' +
        `are UNVERIFIED (this run proves packer determinism only). Set ${REBUILD_CHECKOUTS_ENV_VAR}=1 ` +
        "on a leg that has network access — release-e2e.yml — to run the real npm ci + npm run " +
        "build leg.",
    );
  }
  if (!inputs.enginePin.match) {
    reasons.push("the two clean checkouts disagree on the exact-pinned SDK dependency version.");
  }
  if (!inputs.enginePin.matchesBaseline) {
    reasons.push(
      `the SDK pin does not match the expected baseline (${inputs.enginePin.pinA} / ${inputs.enginePin.pinB}).`,
    );
  }
  if (!inputs.publishDryRun.metadata.ready) {
    reasons.push(
      `package metadata is not provenance-attestation-ready: ${inputs.publishDryRun.metadata.findings.join(" ")}`,
    );
  }
  return reasons;
}

/**
 * The three PREPARERS that this gate used to compute and then ignore.
 * Scoring them is a genuine cross-check, not a formality: each prepared
 * artifact must agree with the release version and with the exact
 * release-candidate object id the rest of the gate ran against.
 */
function preparedArtifactReasons(inputs: ReleaseGateVerdictInputs): readonly string[] {
  const reasons: string[] = [];
  if (inputs.marketplaceEntry.version !== inputs.version) {
    reasons.push(
      `the PREPARED marketplace entry's version is ${inputs.marketplaceEntry.version}, not the ` +
        `release version ${inputs.version}.`,
    );
  }
  if (inputs.marketplaceEntry.commit !== inputs.releaseCandidateObjectId) {
    reasons.push(
      `the PREPARED marketplace entry pins commit ${inputs.marketplaceEntry.commit}, not the ` +
        `release candidate ${inputs.releaseCandidateObjectId}.`,
    );
  }
  // AN EMPTY DRAFT IS ONLY A PROBLEM IF NOTHING ELSE BACKS THE RELEASE.
  //
  // This used to block unconditionally on a header-only draft, which made
  // the criterion unsatisfiable at an actual release cut: the draft is
  // synthesized from PENDING `.changeset/*.md` entries, and
  // `changeset version` CONSUMES those entries to write `CHANGELOG.md`. So
  // the gate demanded pending changesets AND a committed changelog entry —
  // mutually exclusive states, one before versioning and one after. Cutting
  // 1.0.0 is what surfaced it.
  //
  // What the clause actually exists to guarantee is that REVIEWED change
  // notes back the release, and after versioning those notes live in
  // `CHANGELOG.md`, which `checkChangelogEntry` verifies independently and
  // whose reasons are folded into the same verdict. The draft is therefore
  // only owed when the committed changelog does not already carry this
  // version — never both, never neither.
  const changelogBacksRelease = inputs.releaseArtifacts.changelog.reasons.length === 0;
  if (isPlaceholderChangelogDraft(inputs.changelogDraft)) {
    if (!changelogBacksRelease) {
      reasons.push(
        "the PREPARED CHANGELOG draft is the header-only placeholder — zero .changeset/*.md " +
          `entries exist, and no committed CHANGELOG.md entry backs a ${inputs.version} ` +
          "release either, so nothing reviewed records what is shipping.",
      );
    }
  } else if (!inputs.changelogDraft.includes(`## ${inputs.version}`)) {
    reasons.push(`the PREPARED CHANGELOG draft carries no "## ${inputs.version}" section heading.`);
  }
  if (!inputs.tagScript.includes(`git tag -a 'v${inputs.version}'`)) {
    reasons.push(`the PREPARED tag script does not create the release tag v${inputs.version}.`);
  }
  return reasons;
}

/**
 * Pure verdict/reasons computation — split out from `runReleaseGateSummary`
 * so every branch (which combination of checks passed/failed) is directly
 * unit-testable against hand-built result fixtures, without needing a real
 * git/npm round trip per case. Reason order is stable: build facts, then
 * the prepared artifacts, then the repository-state checks in criterion
 * order, and finally the registry-state check (publication), which is the
 * only one that leaves this machine.
 */
export function computeReleaseGateVerdict(inputs: ReleaseGateVerdictInputs): {
  readonly verdict: "PASS" | "FAIL";
  readonly reasons: readonly string[];
} {
  const reasons = [
    ...buildReasons(inputs),
    ...preparedArtifactReasons(inputs),
    ...inputs.releaseArtifacts.changelog.reasons,
    ...inputs.releaseArtifacts.releaseTag.reasons,
    ...inputs.releaseArtifacts.marketplacePin.reasons,
    ...inputs.releaseArtifacts.npmNameRecheck.reasons,
    ...inputs.releaseArtifacts.publication.reasons,
  ];
  return { verdict: reasons.length === 0 ? "PASS" : "FAIL", reasons };
}

export interface RunAndEmitReleaseGateSummaryOptions extends ReleaseGateSummaryOptions {
  readonly journal: JournalStore;
  readonly changeSetId: string;
  readonly objectId?: string;
}

/**
 * Runs `runReleaseGateSummary` and journals its verdict as `EvidenceRecord`s
 * under `release-gate:reproducible-build` (this checklist item's own
 * dedicated tag) and, only when the SDK-pin cross-check itself passed,
 * under `release-gate:engine-pin-recorded` too.
 *
 * The two tags are emitted with their OWN exit statuses, in separate
 * calls: `e2e/report`'s generator fails an item when ANY linked record is
 * non-zero, so folding both tags into one emission would let a genuine
 * reproducible-build FAIL turn engine-pin-recorded — a separate checklist
 * item whose own check passed — into a false negative.
 */
export async function runAndEmitReleaseGateSummaryEvidence(
  options: RunAndEmitReleaseGateSummaryOptions,
): Promise<ReleaseGateSummaryResult> {
  const result = await runReleaseGateSummary(options);
  const objectIdOption = options.objectId !== undefined ? { objectId: options.objectId } : {};
  await emitReproducibleBuildEvidence({
    journal: options.journal,
    changeSetId: options.changeSetId,
    gateTags: [REPRODUCIBLE_BUILD_GATE_TAG],
    command: "release-gate-summary",
    exitStatus: result.verdict === "PASS" ? 0 : 1,
    ...objectIdOption,
    artifactDigests: [
      `sha256:${createHash("sha256").update(result.reproducibleBuild.comparison.hashA).digest("hex")}`,
      `sha256:${createHash("sha256").update(result.enginePin.pinA).digest("hex")}`,
    ],
  });
  if (result.enginePin.match && result.enginePin.matchesBaseline) {
    await emitReproducibleBuildEvidence({
      journal: options.journal,
      changeSetId: options.changeSetId,
      gateTags: [ENGINE_PIN_RECORDED_GATE_TAG],
      command: "release-gate-summary",
      exitStatus: 0,
      ...objectIdOption,
      artifactDigests: [
        `sha256:${createHash("sha256").update(result.enginePin.pinA).digest("hex")}`,
      ],
    });
  }
  return result;
}
