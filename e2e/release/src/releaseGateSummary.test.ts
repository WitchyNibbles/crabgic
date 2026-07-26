import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeReleaseGateVerdict,
  PUBLISHED_PACKAGE_NAME,
  runAndEmitReleaseGateSummaryEvidence,
  type ReleaseGateVerdictInputs,
} from "./releaseGateSummary.js";
import { EXPECTED_SDK_PIN } from "./enginePinCheck.js";
import { ENGINE_PIN_RECORDED_GATE_TAG, REPRODUCIBLE_BUILD_GATE_TAG } from "./evidence.js";
import { REBUILD_CHECKOUTS_ENV_VAR } from "./rebuildPopulator.js";
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

const RC = "a".repeat(40);

/**
 * Read ONCE, here, and branched on rather than assumed: this whole project
 * runs in two configurations, and the composed-gate integration test below
 * must be green in both. `1` is what `release-e2e.yml` (the leg with
 * network) is meant to set; everything else is the offline default.
 */
const rebuilding = process.env[REBUILD_CHECKOUTS_ENV_VAR] === "1";

/** Every constituent check green — each case below perturbs exactly one thing. */
function passingInputs(): ReleaseGateVerdictInputs {
  return {
    version: "1.0.0",
    releaseCandidateObjectId: RC,
    reproducibleBuild: {
      comparison: { match: true, hashA: "x", hashB: "x", sizeA: 1, sizeB: 1 },
      rebuiltFromCleanCheckout: true,
    },
    enginePin: {
      match: true,
      matchesBaseline: true,
      pinA: EXPECTED_SDK_PIN,
      pinB: EXPECTED_SDK_PIN,
    },
    publishDryRun: { metadata: PASSING_METADATA },
    marketplaceEntry: { version: "1.0.0", commit: RC },
    changelogDraft:
      "## 1.0.0 (2026-07-25)\n\n- a real, reviewed change note (@crabgic/cli: major)\n",
    tagScript: "git tag -a 'v1.0.0' -m 'Release v1.0.0' 'HEAD'\n",
    releaseArtifacts: {
      changelog: { reasons: [] },
      releaseTag: { reasons: [] },
      marketplacePin: { reasons: [] },
      npmNameRecheck: { reasons: [] },
      publication: { reasons: [] },
    },
  };
}

function verdictWith(overrides: Partial<ReleaseGateVerdictInputs>): {
  readonly verdict: "PASS" | "FAIL";
  readonly reasons: readonly string[];
} {
  return computeReleaseGateVerdict({ ...passingInputs(), ...overrides });
}

describe("computeReleaseGateVerdict — unit", () => {
  it("reports PASS with zero reasons when every constituent check passes", () => {
    expect(computeReleaseGateVerdict(passingInputs())).toEqual({ verdict: "PASS", reasons: [] });
  });

  it("FAIL-FIRST PROOF: reports FAIL with a specific reason when the tarball comparison mismatches", () => {
    const result = verdictWith({
      reproducibleBuild: {
        comparison: { match: false, hashA: "x", hashB: "y", sizeA: 1, sizeB: 1 },
        rebuiltFromCleanCheckout: true,
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toEqual([
      "two independent clean checkouts produced DIFFERENT tarball hashes — reproducible build FAILED.",
    ]);
  });

  it("reports FAIL when the checkouts were NOT rebuilt from clean — the exit criterion's own words", () => {
    const result = verdictWith({
      reproducibleBuild: {
        comparison: { match: true, hashA: "x", hashB: "x", sizeA: 1, sizeB: 1 },
        rebuiltFromCleanCheckout: false,
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain(REBUILD_CHECKOUTS_ENV_VAR);
  });

  it("reports FAIL when the two checkouts' SDK pins disagree with each other", () => {
    const result = verdictWith({
      enginePin: { match: false, matchesBaseline: false, pinA: "0.3.210", pinB: "0.3.218" },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toHaveLength(2); // both "disagree" and "not baseline"
  });

  it("reports FAIL when both pins agree with each other but not with the expected baseline", () => {
    const result = verdictWith({
      enginePin: { match: true, matchesBaseline: false, pinA: "0.9.9", pinB: "0.9.9" },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toEqual([
      "the SDK pin does not match the expected baseline (0.9.9 / 0.9.9).",
    ]);
  });

  it("reports FAIL when publish metadata is not provenance-ready", () => {
    const result = verdictWith({
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

describe("computeReleaseGateVerdict — the three preparers that used to be computed and ignored", () => {
  it("scores the PREPARED marketplace entry's version against the release version", () => {
    const result = verdictWith({ marketplaceEntry: { version: "0.0.0", commit: RC } });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("0.0.0");
  });

  it("scores the PREPARED marketplace entry's commit against the release candidate object id", () => {
    const result = verdictWith({
      marketplaceEntry: { version: "1.0.0", commit: "b".repeat(40) },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("b".repeat(40));
  });

  it("scores the PREPARED CHANGELOG draft: the header-only placeholder is not reviewed change notes", () => {
    const result = verdictWith({
      changelogDraft:
        "## 1.0.0 (2026-07-25)\n\n_No `.changeset/*.md` entries were recorded at draft time — this is a header-only placeholder. Author real changesets (`npx changeset add`) before the actual v1.0.0 cut so this section reflects real, reviewed change notes._\n",
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("placeholder");
  });

  it("scores the PREPARED CHANGELOG draft's own version heading", () => {
    const result = verdictWith({ changelogDraft: "## 0.9.0 (2026-07-25)\n\n- notes\n" });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("## 1.0.0");
  });

  it("scores the PREPARED tag script: it must actually create the release tag", () => {
    const result = verdictWith({ tagScript: "echo 'nothing to see here'\n" });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("v1.0.0");
  });
});

describe("computeReleaseGateVerdict — the previously unverified exit-criterion clauses", () => {
  it("folds every release-artifact check's own reasons into the verdict, in a stable order", () => {
    const result = verdictWith({
      releaseArtifacts: {
        changelog: { reasons: ["no CHANGELOG.md"] },
        releaseTag: { reasons: ["no v1.0.0 tag"] },
        marketplacePin: { reasons: ["not SHA-pinned"] },
        npmNameRecheck: { reasons: ["stale npm-name record"] },
        publication: { reasons: ["never published"] },
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toEqual([
      "no CHANGELOG.md",
      "no v1.0.0 tag",
      "not SHA-pinned",
      "stale npm-name record",
      "never published",
    ]);
  });

  it("scores the `package published` clause, which nothing in this gate used to score at all", () => {
    const result = verdictWith({
      releaseArtifacts: {
        ...passingInputs().releaseArtifacts,
        publication: { reasons: ["the npm registry reports it has never been published"] },
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toEqual(["the npm registry reports it has never been published"]);
  });
});

describe("PUBLISHED_PACKAGE_NAME", () => {
  it("still matches packages/cli/package.json's own name (freshness — the npm-name re-check is about THIS name)", async () => {
    const repoRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: import.meta.dirname })
    ).stdout.trim();
    const manifest = JSON.parse(
      await readFile(resolve(repoRoot, "packages", "cli", "package.json"), "utf8"),
    ) as { readonly name: string };
    expect(PUBLISHED_PACKAGE_NAME).toBe(manifest.name);
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

  it(
    "runs every real constituent check, reports today's real overall verdict, and journals matching evidence",
    async () => {
      const objectId = (
        await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
      ).stdout.trim();
      // A per-run id, not a fixed literal: `objectId` below is this repo's
      // REAL `HEAD` — i.e. exactly the release-candidate object id every
      // OTHER harness also tags its evidence with during a release run — so
      // under a shared journal (`CRABGIC_RELEASE_GATE_JOURNAL_DIR`, see
      // `./testJournal.ts`) objectId alone cannot isolate this test's own
      // records. The changeSetId is what does.
      const changeSetId = randomUUID();
      const result = await runAndEmitReleaseGateSummaryEvidence({
        journal: tj.store,
        changeSetId,
        objectId,
        repoRoot,
        commitIsh: "HEAD",
        cliPackageSubPath: "packages/cli",
        enginePackageSubPath: "packages/engine-claude",
        pluginRoot: resolve(repoRoot, "packages", "plugin"),
        version: "1.0.0",
      });

      // Real, current facts this harness independently verifies and that
      // genuinely PASS: the packer is deterministic given identical source
      // + identical build output, the SDK pin is identical and matches the
      // baseline, and publish metadata is provenance-ready.
      expect(result.reproducibleBuild.comparison.match).toBe(true);
      expect(result.enginePin.match).toBe(true);
      expect(result.enginePin.matchesBaseline).toBe(true);
      expect(result.publishDryRun.metadata.ready).toBe(true);
      expect(result.publishDryRun.skippedDueToPrivate).toBe(true);
      expect(result.publishDryRun.realPublishAttempted).toBe(false);
      expect(result.marketplaceEntry.version).toBe("1.0.0");
      expect(result.changelogDraft).toContain("## 1.0.0");
      expect(result.tagScript).toContain("git tag -a 'v1.0.0'");

      // ...and the clauses of the SAME exit criterion that are NOT met.
      // This item is FAIL today by design: making it green means cutting a
      // real release (CHANGELOG, tag, marketplace pin, npm re-check, an
      // actual publish), which is the owner's action, not this harness's.
      expect(result.verdict).toBe("FAIL");
      const joined = result.reasons.join("\n");
      expect(joined).toContain("CHANGELOG.md");
      expect(joined).toContain("v1.0.0 tag");
      expect(joined).toContain("all-zero placeholder");
      expect(joined).toContain("npm view");
      expect(joined).toContain("package published");
      // TWO publication reasons, both true and both independently checked:
      // the manifest is `"private": true` (so `npm publish` would refuse it
      // outright), AND the real registry says the name has nothing
      // published under it at all.
      expect(result.publication.manifestPrivate).toBe(true);
      expect(result.publication.published).toBe(false);
      expect(result.publication.reasons).toHaveLength(2);

      // The rebuild clause is the ONE reason whose presence depends on how
      // this leg was invoked, so it is asserted BOTH ways rather than
      // hard-coded to the no-network default. Under
      // `CRABGIC_RELEASE_REBUILD_CHECKOUTS=1` — the configuration release-e2e.yml
      // is meant to run — two real `npm ci` + `npm run build` runs happen in
      // the two whole-repo exports, the clause is genuinely satisfied, and
      // the reason is correctly absent. Asserting its presence
      // unconditionally would turn the flag path red on a false failure.
      expect(result.reproducibleBuild.rebuiltFromCleanCheckout).toBe(rebuilding);
      if (rebuilding) {
        expect(joined).not.toContain(REBUILD_CHECKOUTS_ENV_VAR);
        expect(result.reasons).toHaveLength(7);
      } else {
        expect(joined).toContain(REBUILD_CHECKOUTS_ENV_VAR);
        expect(result.reasons).toHaveLength(8);
      }

      const byTag = new Map<string, number>();
      for await (const entry of tj.store.queryEntries({ type: "evidence_pointer", changeSetId })) {
        if (entry.type !== "evidence_pointer") continue;
        if (entry.payload.objectId !== objectId) continue;
        if (entry.payload.gateTag !== undefined) {
          byTag.set(entry.payload.gateTag, entry.payload.exitStatus);
        }
      }
      // Scored INDEPENDENTLY: the SDK-pin cross-check genuinely passed, so
      // its own checklist item's evidence must stay green even though the
      // composed reproducible-build verdict is a genuine FAIL. Emitting one
      // shared exit status would have turned engine-pin-recorded into a
      // false negative.
      expect(byTag.get(REPRODUCIBLE_BUILD_GATE_TAG)).toBe(1);
      expect(byTag.get(ENGINE_PIN_RECORDED_GATE_TAG)).toBe(0);
      expect([...byTag.keys()].sort()).toEqual(
        [REPRODUCIBLE_BUILD_GATE_TAG, ENGINE_PIN_RECORDED_GATE_TAG].sort(),
      );
    },
    rebuilding ? 900_000 : 120_000,
  );

  it("rejects a commit-ish that resolves to no commit, rather than silently checking nothing", async () => {
    await expect(
      runAndEmitReleaseGateSummaryEvidence({
        journal: tj.store,
        changeSetId: randomUUID(),
        repoRoot,
        commitIsh: "eo-definitely-not-a-real-ref",
        cliPackageSubPath: "packages/cli",
        enginePackageSubPath: "packages/engine-claude",
        pluginRoot: resolve(repoRoot, "packages", "plugin"),
        version: "1.0.0",
      }),
    ).rejects.toThrow("eo-definitely-not-a-real-ref");
  });
});
