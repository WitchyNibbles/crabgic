import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeReleaseGateVerdict,
  runAndEmitReleaseGateSummaryEvidence,
} from "./releaseGateSummary.js";
import { EXPECTED_SDK_PIN } from "./enginePinCheck.js";
import { ENGINE_PIN_RECORDED_GATE_TAG, REPRODUCIBLE_BUILD_GATE_TAG } from "./evidence.js";
import { createTestJournal, type TestJournal } from "./testJournal.js";

const execFileAsync = promisify(execFile);

const PASSING_METADATA = {
  hasLicenseApache2: true,
  hasPublicAccess: true,
  hasRepositoryField: true,
  hasName: true,
  ready: true,
  findings: [],
};

describe("computeReleaseGateVerdict — unit", () => {
  it("reports PASS with zero reasons when every constituent check passes", () => {
    const result = computeReleaseGateVerdict({
      reproducibleBuild: {
        comparison: { match: true, hashA: "x", hashB: "x", sizeA: 1, sizeB: 1 },
      },
      enginePin: {
        match: true,
        matchesBaseline: true,
        pinA: EXPECTED_SDK_PIN,
        pinB: EXPECTED_SDK_PIN,
      },
      publishDryRun: { metadata: PASSING_METADATA },
    });
    expect(result).toEqual({ verdict: "PASS", reasons: [] });
  });

  it("FAIL-FIRST PROOF: reports FAIL with a specific reason when the tarball comparison mismatches", () => {
    const result = computeReleaseGateVerdict({
      reproducibleBuild: {
        comparison: { match: false, hashA: "x", hashB: "y", sizeA: 1, sizeB: 1 },
      },
      enginePin: {
        match: true,
        matchesBaseline: true,
        pinA: EXPECTED_SDK_PIN,
        pinB: EXPECTED_SDK_PIN,
      },
      publishDryRun: { metadata: PASSING_METADATA },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toEqual([
      "two independent clean checkouts produced DIFFERENT tarball hashes — reproducible build FAILED.",
    ]);
  });

  it("reports FAIL when the two checkouts' SDK pins disagree with each other", () => {
    const result = computeReleaseGateVerdict({
      reproducibleBuild: {
        comparison: { match: true, hashA: "x", hashB: "x", sizeA: 1, sizeB: 1 },
      },
      enginePin: { match: false, matchesBaseline: false, pinA: "0.3.210", pinB: "0.3.218" },
      publishDryRun: { metadata: PASSING_METADATA },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toHaveLength(2); // both "disagree" and "not baseline"
  });

  it("reports FAIL when both pins agree with each other but not with the expected baseline", () => {
    const result = computeReleaseGateVerdict({
      reproducibleBuild: {
        comparison: { match: true, hashA: "x", hashB: "x", sizeA: 1, sizeB: 1 },
      },
      enginePin: { match: true, matchesBaseline: false, pinA: "0.9.9", pinB: "0.9.9" },
      publishDryRun: { metadata: PASSING_METADATA },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toEqual([
      "the SDK pin does not match the expected baseline (0.9.9 / 0.9.9).",
    ]);
  });

  it("reports FAIL when publish metadata is not provenance-ready (today's real repository-field gap)", () => {
    const result = computeReleaseGateVerdict({
      reproducibleBuild: {
        comparison: { match: true, hashA: "x", hashB: "x", sizeA: 1, sizeB: 1 },
      },
      enginePin: {
        match: true,
        matchesBaseline: true,
        pinA: EXPECTED_SDK_PIN,
        pinB: EXPECTED_SDK_PIN,
      },
      publishDryRun: {
        metadata: {
          ...PASSING_METADATA,
          hasRepositoryField: false,
          ready: false,
          findings: ["repository missing"],
        },
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons[0]).toContain("repository missing");
  });
});

describe("runAndEmitReleaseGateSummaryEvidence — genuine integration (real git/npm, this repo's own HEAD, NEVER a real publish/tag/marketplace mutation)", () => {
  let tj: TestJournal;
  let repoRoot: string;

  beforeEach(async () => {
    tj = await createTestJournal();
    repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
  });

  afterEach(async () => {
    await tj.cleanup();
  });

  it("runs every real constituent check, reports today's real overall verdict, and journals matching evidence", async () => {
    const objectId = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
    ).stdout.trim();
    const result = await runAndEmitReleaseGateSummaryEvidence({
      journal: tj.store,
      changeSetId: "33333333-3333-4333-8333-333333333333",
      objectId,
      repoRoot,
      commitIsh: "HEAD",
      cliPackageSubPath: "packages/cli",
      enginePackageSubPath: "packages/engine-claude",
      pluginRoot: resolve(repoRoot, "packages", "plugin"),
      version: "1.0.0",
    });

    // Real, current facts this harness has independently verified: tarball
    // reproducibility PASSES, the SDK pin PASSES, and publish metadata is
    // now provenance-ready — the "repository" field that made this FAIL
    // was added in the phase-23 publish-prep pass.
    //
    // A PASS here is emphatically NOT "ready to publish": packages/cli
    // remains "private": true by the owner's PREPARE-DON'T-PUBLISH
    // decision, so npm refuses the publish itself regardless of this gate.
    // What this asserts is narrower and true — the release ARTIFACT and its
    // metadata are in order. The two assertions below pin that guard so a
    // PASS can never quietly come to mean a publish was attempted.
    expect(result.reproducibleBuild.comparison.match).toBe(true);
    expect(result.enginePin.match).toBe(true);
    expect(result.enginePin.matchesBaseline).toBe(true);
    expect(result.publishDryRun.metadata.ready).toBe(true);
    expect(result.publishDryRun.skippedDueToPrivate).toBe(true);
    expect(result.publishDryRun.realPublishAttempted).toBe(false);
    expect(result.verdict).toBe("PASS");
    expect(result.marketplaceEntry.version).toBe("1.0.0");
    expect(result.changelogDraft).toContain("## 1.0.0");
    expect(result.tagScript).toContain("git tag -a 'v1.0.0'");

    const tags: string[] = [];
    for await (const entry of tj.store.queryEntries({ type: "evidence_pointer" })) {
      if (entry.type !== "evidence_pointer") continue;
      if (entry.payload.objectId !== objectId) continue;
      if (entry.payload.gateTag !== undefined) tags.push(entry.payload.gateTag);
    }
    // engine-pin-recorded IS emitted (the pin check itself passed) even
    // though the OVERALL verdict is FAIL (a different check's own gap) —
    // see runAndEmitReleaseGateSummaryEvidence's own doc comment on why
    // these are scored independently.
    expect(tags.sort()).toEqual([REPRODUCIBLE_BUILD_GATE_TAG, ENGINE_PIN_RECORDED_GATE_TAG].sort());
  }, 60_000);
});
