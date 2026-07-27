import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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

/** The version this repository is actually preparing — `packages/cli/package.json`'s own, which is what `changeset version` bumps and what the tag/changelog/publication clauses are all cut against. */
function releaseVersion(repoRoot: string): string {
  const raw = readFileSync(resolve(repoRoot, "packages", "cli", "package.json"), "utf8");
  return (JSON.parse(raw) as { readonly version: string }).version;
}

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

  const PLACEHOLDER_DRAFT =
    "## 1.0.0 (2026-07-25)\n\n_No `.changeset/*.md` entries were recorded at draft time — this is a header-only placeholder. Author real changesets (`npx changeset add`) before the actual v1.0.0 cut so this section reflects real, reviewed change notes._\n";

  /**
   * THE DRAFT AND THE COMMITTED CHANGELOG ARE ALTERNATIVES, NOT BOTH.
   *
   * The draft is synthesized from PENDING `.changeset/*.md` entries, and
   * `changeset version` consumes those entries to write `CHANGELOG.md`.
   * Blocking unconditionally on a header-only draft therefore demanded two
   * mutually exclusive states at once — pending changesets AND a committed
   * changelog entry — and made the clause unsatisfiable at an actual release
   * cut. What it exists to guarantee is that reviewed notes back the
   * release, from whichever of the two places currently holds them.
   */
  it("does NOT block on a header-only draft when the committed CHANGELOG backs the release", () => {
    const result = verdictWith({ changelogDraft: PLACEHOLDER_DRAFT });
    expect(result.reasons.join("\n")).not.toContain("placeholder");
    expect(result.verdict).toBe("PASS");
  });

  it("DOES block on a header-only draft when nothing else records what is shipping", () => {
    const result = verdictWith({
      changelogDraft: PLACEHOLDER_DRAFT,
      releaseArtifacts: {
        ...passingInputs().releaseArtifacts,
        changelog: { reasons: ["no CHANGELOG.md exists at the repository root"] },
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.reasons.join("\n")).toContain("nothing reviewed records what is shipping");
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
        // THE VERSION ACTUALLY BEING RELEASED, read from the manifest rather
        // than a literal. This used to be a hardcoded "1.0.0", so from 1.0.1
        // onward the composed gate scored every candidate against the WRONG
        // release: it looked for a `v1.0.0` tag and a `## 1.0.0` changelog
        // entry while the repository was preparing something else entirely,
        // and reported the resulting mismatches as release-blocking reasons.
        // The clause it is meant to check — "does the repository evidence THE
        // release it is cutting" — is only meaningful against the real one.
        version: releaseVersion(repoRoot),
      });

      // Real, current facts this harness independently verifies and that
      // genuinely PASS: the packer is deterministic given identical source
      // + identical build output, the SDK pin is identical and matches the
      // baseline, and publish metadata is provenance-ready.
      expect(result.reproducibleBuild.comparison.match).toBe(true);
      expect(result.enginePin.match).toBe(true);
      expect(result.enginePin.matchesBaseline).toBe(true);
      expect(result.publishDryRun.metadata.ready).toBe(true);
      // NEVER a real publish — the invariant that holds on both sides of the
      // PREPARE-DON'T-PUBLISH latch, and the one that actually matters here.
      expect(result.publishDryRun.realPublishAttempted).toBe(false);
      // Every prepared artifact names the version actually being released,
      // not a literal — these three used to hardcode 1.0.0 alongside the
      // input above, which is what let the mismatch go unnoticed from 1.0.1
      // onward.
      const version = releaseVersion(repoRoot);
      expect(result.marketplaceEntry.version).toBe(version);
      expect(result.changelogDraft).toContain(`## ${version}`);
      expect(result.tagScript).toContain(`git tag -a 'v${version}'`);

      // ...and the clauses of the SAME exit criterion that are NOT met.
      // This item is FAIL today by design: making it green means cutting a
      // real release (CHANGELOG, tag, marketplace pin, an actual publish),
      // which is the owner's action, not this harness's.
      // EVERY clause of the criterion is now satisfiable, and the publish
      // clause actually is: crabgic@1.0.0 shipped with provenance, so the
      // registry answers for it and `publication` carries no reason. What
      // this case still exercises is that the composite really runs each
      // constituent check against the real repository — the verdict itself
      // depends on which commit is being scored (see the reason categories
      // below), so it is deliberately not pinned here.
      const joined = result.reasons.join("\n");
      expect(result.publication.published).toBe(true);
      expect(result.publication.reasons).toEqual([]);
      expect(joined).not.toContain("package published");

      // Cleared by the 1.0.0 preparation, each asserted as an ABSENCE so it
      // cannot silently regress: the tag exists and points at the candidate,
      // and the marketplace entry is pinned there rather than at git's
      // all-zero null object ID.
      // The v1.0.0 tag EXISTS and the marketplace entry is SHA-pinned — the
      // two clauses the 1.0.0 preparation cut. Whether they point at the
      // commit being scored is a different question, and deliberately not
      // asserted here: this harness runs against whatever HEAD happens to be,
      // and HEAD moves with every commit after a cut while the tag stays put.
      // Pinning "tag === HEAD" would make an ordinary commit fail the suite.
      // `releaseTagCheck.test.ts` and `marketplacePinCheck.test.ts` own the
      // matching rule and assert it in both directions against the real repo.
      expect(result.releaseTag.exists).toBe(true);
      expect(result.marketplacePin.pinned).toBe(true);
      expect(result.marketplacePin.resolvesInRepo).toBe(true);
      expect(joined).not.toContain("no v1.0.0 tag exists");
      expect(joined).not.toContain("all-zero placeholder");

      // The CHANGELOG clause is NO LONGER among them: 1.0.0's notes were cut
      // from a reviewed changeset into both CHANGELOG.md and
      // packages/cli/CHANGELOG.md. Asserted as an absence for the same
      // reason as the npm-name one below — a quietly dropped expectation
      // would let the clause regress unnoticed.
      expect(result.changelog.reasons).toEqual([]);
      expect(joined).not.toContain("no CHANGELOG.md exists");

      // The npm-name re-check is NO LONGER among them, and its absence is
      // asserted rather than merely dropped. It was a blocking reason for as
      // long as the recorded verdict was phase 01's; re-probing the registry
      // for the renamed package (`docs/release-notes-prep.md`, 2026-07-26)
      // put it back inside its release-time window. Asserting the absence is
      // what keeps this list honest in both directions — a silently dropped
      // expectation would let the clause regress unnoticed.
      expect(result.npmNameRecheck.fresh).toBe(true);
      expect(joined).not.toContain("npm view");
      // ZERO publication reasons now, where there were two. The first went
      // when the `"private": true` latch was released to prepare 1.0.0; the
      // second — "the registry has nothing under this name" — went when
      // crabgic@1.0.0 was actually published with provenance. Both are
      // asserted rather than dropped so a regression in either is visible.
      expect(result.publication.manifestPrivate).toBe(false);
      expect(result.publication.published).toBe(true);
      expect(result.publication.reasons).toEqual([]);

      // The rebuild clause is the ONE reason whose presence depends on how
      // this leg was invoked, so it is asserted BOTH ways rather than
      // hard-coded to the no-network default. Under
      // `CRABGIC_RELEASE_REBUILD_CHECKOUTS=1` — the configuration release-e2e.yml
      // is meant to run — two real `npm ci` + `npm run build` runs happen in
      // the two whole-repo exports, the clause is genuinely satisfied, and
      // the reason is correctly absent. Asserting its presence
      // unconditionally would turn the flag path red on a false failure.
      // Counts as the 1.0.0 preparation landed, from 8/7 originally: -1 for
      // the re-probed npm-name verdict, -1 for the CHANGELOG, -1 for the
      // released `"private": true` latch, -1 for the tag, -1 for the
      // marketplace pin. What is left is the publish, plus the rebuild
      // clause when this runs without the flag.
      expect(result.reproducibleBuild.rebuiltFromCleanCheckout).toBe(rebuilding);
      if (rebuilding) {
        expect(joined).not.toContain(REBUILD_CHECKOUTS_ENV_VAR);
        expect(joined).not.toContain(REBUILD_CHECKOUTS_ENV_VAR);
      } else {
        expect(joined).toContain(REBUILD_CHECKOUTS_ENV_VAR);
      }

      // EVERY remaining reason must be one this harness expects, rather than a
      // count. Counting proved brittle: the tag and the marketplace pin name
      // the commit that was CUT, and this integration case runs against
      // whatever HEAD is, so both legitimately report a mismatch on any commit
      // after the cut and stop reporting one the moment a new release is cut.
      // Asserting the categories keeps the case meaningful — an unexpected
      // reason still fails it — without making ordinary commits red.
      const EXPECTED_REASON_PATTERNS = [
        /npm registry reports/,
        /does not evidence THIS candidate/,
        /binds a different commit|not at the release candidate|not the release candidate/,
        new RegExp(REBUILD_CHECKOUTS_ENV_VAR),
      ];
      for (const reason of result.reasons) {
        expect(
          EXPECTED_REASON_PATTERNS.some((pattern) => pattern.test(reason)),
          `unexpected release-gate reason: ${reason}`,
        ).toBe(true);
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
      // its own checklist item's evidence must stay green even where the
      // composed reproducible-build verdict is a genuine FAIL. Emitting one
      // shared exit status would have turned engine-pin-recorded into a
      // false negative.
      //
      // The reproducible-build status is asserted as the INVARIANT — the
      // emitted exit status is the verdict — rather than pinned to 1. It used
      // to be pinned, back when the clause was unsatisfiable by construction
      // ("FAIL today by design"). It no longer is: on a properly cut release
      // commit every clause can now be met, so hardcoding the failure would
      // turn a correct green into a red the moment one is cut, and would hide
      // a regression that flipped it back.
      expect(byTag.get(REPRODUCIBLE_BUILD_GATE_TAG)).toBe(result.verdict === "PASS" ? 0 : 1);
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
