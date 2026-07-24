import { createHash } from "node:crypto";
import { join } from "node:path";
import type { JournalStore } from "@eo/journal";
import type { MarketplacePluginEntry } from "@eo/plugin";
import { GitArchiveExporter } from "./checkoutExporter.js";
import { RealPackRunner } from "./packRunner.js";
import {
  checkReproducibleBuild,
  createCopyCurrentDistPopulator,
  type ReproducibleBuildCheckResult,
} from "./reproducibleBuildCheck.js";
import { checkEnginePinAcrossCheckouts, type EnginePinCheckResult } from "./enginePinCheck.js";
import {
  RealPublishRunner,
  runPublishDryRun,
  type PublishDryRunResult,
} from "./publishDryRunCheck.js";
import { prepareMarketplaceEntry } from "./marketplaceEntryPreparer.js";
import { draftChangelog, readChangesetEntries } from "./changelogDraftPreparer.js";
import { prepareTagScript } from "./releaseTagScriptPreparer.js";
import {
  emitReproducibleBuildEvidence,
  ENGINE_PIN_RECORDED_GATE_TAG,
  REPRODUCIBLE_BUILD_GATE_TAG,
} from "./evidence.js";

/**
 * The composed reproducible-build + publication-dry-run gate —
 * roadmap/23-release-hardening.md work item 10. Runs every real check this
 * project builds (tarball comparator, engine-pin cross-check, publish
 * dry-run + metadata, marketplace-entry/changelog/tag-script preparers)
 * against the SAME `commitIsh` and folds them into one verdict. PREPARE-
 * DON'T-PUBLISH: nothing here ever actually publishes/tags/mutates the
 * marketplace — see each constituent module's own doc comment for its own
 * specific guarantee.
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
}

export interface ReleaseGateSummaryResult {
  readonly reproducibleBuild: ReproducibleBuildCheckResult;
  readonly enginePin: EnginePinCheckResult;
  readonly publishDryRun: PublishDryRunResult;
  readonly marketplaceEntry: MarketplacePluginEntry;
  readonly changelogDraft: string;
  readonly tagScript: string;
  readonly verdict: "PASS" | "FAIL";
  readonly reasons: readonly string[];
}

export async function runReleaseGateSummary(
  options: ReleaseGateSummaryOptions,
): Promise<ReleaseGateSummaryResult> {
  const exporter = new GitArchiveExporter({ repoRoot: options.repoRoot });
  const packRunner = new RealPackRunner();
  const populateBuildOutput = createCopyCurrentDistPopulator(
    options.repoRoot,
    options.cliPackageSubPath,
  );

  const [reproducibleBuild, enginePin, publishDryRun, marketplaceEntry] = await Promise.all([
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
  ]);

  const changesetEntries = readChangesetEntries(join(options.repoRoot, ".changeset"));
  const changelogDraft = draftChangelog({ version: options.version, entries: changesetEntries });
  const tagScript = prepareTagScript({
    tagName: `v${options.version}`,
    message: `Release v${options.version}`,
    commitIsh: options.commitIsh,
  });

  const { verdict, reasons } = computeReleaseGateVerdict({
    reproducibleBuild,
    enginePin,
    publishDryRun,
  });

  return {
    reproducibleBuild,
    enginePin,
    publishDryRun,
    marketplaceEntry,
    changelogDraft,
    tagScript,
    verdict,
    reasons,
  };
}

/**
 * Pure verdict/reasons computation — split out from `runReleaseGateSummary`
 * so every branch (which combination of checks passed/failed) is directly
 * unit-testable against hand-built result fixtures, without needing a real
 * git/npm round trip per case.
 */
export function computeReleaseGateVerdict(inputs: {
  readonly reproducibleBuild: Pick<ReproducibleBuildCheckResult, "comparison">;
  readonly enginePin: Pick<EnginePinCheckResult, "match" | "matchesBaseline" | "pinA" | "pinB">;
  readonly publishDryRun: Pick<PublishDryRunResult, "metadata">;
}): { readonly verdict: "PASS" | "FAIL"; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  if (!inputs.reproducibleBuild.comparison.match) {
    reasons.push(
      "two independent clean checkouts produced DIFFERENT tarball hashes — reproducible build FAILED.",
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
  return { verdict: reasons.length === 0 ? "PASS" : "FAIL", reasons };
}

export interface RunAndEmitReleaseGateSummaryOptions extends ReleaseGateSummaryOptions {
  readonly journal: JournalStore;
  readonly changeSetId: string;
  readonly objectId?: string;
}

/** Runs `runReleaseGateSummary` and journals its verdict as `EvidenceRecord`s under both `release-gate:reproducible-build` (this checklist item's own dedicated tag) and, only when the SDK-pin cross-check itself passed, `release-gate:engine-pin-recorded` too (that item's own dedicated tag — scored independently, since a pin mismatch shouldn't be silently marked "recorded"). */
export async function runAndEmitReleaseGateSummaryEvidence(
  options: RunAndEmitReleaseGateSummaryOptions,
): Promise<ReleaseGateSummaryResult> {
  const result = await runReleaseGateSummary(options);
  const gateTags = [REPRODUCIBLE_BUILD_GATE_TAG];
  if (result.enginePin.match && result.enginePin.matchesBaseline) {
    gateTags.push(ENGINE_PIN_RECORDED_GATE_TAG);
  }
  await emitReproducibleBuildEvidence({
    journal: options.journal,
    changeSetId: options.changeSetId,
    gateTags,
    command: "release-gate-summary",
    exitStatus: result.verdict === "PASS" ? 0 : 1,
    ...(options.objectId !== undefined ? { objectId: options.objectId } : {}),
    artifactDigests: [
      `sha256:${createHash("sha256").update(result.reproducibleBuild.comparison.hashA).digest("hex")}`,
      `sha256:${createHash("sha256").update(result.enginePin.pinA).digest("hex")}`,
    ],
  });
  return result;
}
