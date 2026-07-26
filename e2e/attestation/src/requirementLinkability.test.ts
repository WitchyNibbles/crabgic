import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, type EvidenceRecord } from "@crabgic/contracts";
import {
  analyzeRequirementLinkability,
  summarizeRequirementLinkability,
  type RequirementLinkabilityStatus,
} from "./requirementLinkability.js";
import { hasCriterionTagRule, readReleaseRequirements } from "./releaseRequirements.js";
import { ATTESTATION_GATE_TAGS } from "./evidence.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function record(over: Partial<EvidenceRecord>): EvidenceRecord {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: "00000000-0000-4000-8000-000000000001",
    changeSetId: "00000000-0000-4000-8000-000000000002",
    command: "attestation:x",
    exitStatus: 0,
    toolchainFingerprint: "test@1",
    capturedAt: "2026-07-26T00:00:00.000Z",
    artifactDigests: [],
    objectId: "a".repeat(40),
    ...over,
  } as EvidenceRecord;
}

describe("analyzeRequirementLinkability — statuses are derived, never assumed", () => {
  const requirements = [
    { id: "req-linked", text: "linked one", gateTags: ["release-gate:alpha"] },
    { id: "req-unstamped", text: "unstamped one", gateTags: ["release-gate:beta"] },
    { id: "req-no-emitter", text: "no emitter", gateTags: ["release-gate:gamma"] },
    { id: "req-umbrella", text: "umbrella", gateTags: [] },
  ];

  const evidence = [
    record({ id: "e1", gateTag: "release-gate:alpha", requirementId: "req-linked" }),
    // beta IS emitted by some harness, but that harness stamps no requirementId.
    record({ id: "e2", gateTag: "release-gate:beta" }),
  ];

  it("classifies a requirement with a requirementId-carrying record as linked", () => {
    const report = analyzeRequirementLinkability({ requirements, evidenceRecords: evidence });
    const entry = report.entries.find((e) => e.requirementId === "req-linked");
    expect(entry?.status).toBe("linked" satisfies RequirementLinkabilityStatus);
    expect(entry?.linkedEvidenceCount).toBe(1);
  });

  it("classifies a requirement whose tag IS emitted but never stamped as unstamped_emitter", () => {
    const report = analyzeRequirementLinkability({ requirements, evidenceRecords: evidence });
    const entry = report.entries.find((e) => e.requirementId === "req-unstamped");
    expect(entry?.status).toBe(
      "unlinkable_unstamped_emitter" satisfies RequirementLinkabilityStatus,
    );
    expect(entry?.observedGateTags).toEqual(["release-gate:beta"]);
  });

  it("classifies a requirement whose tags appear nowhere in the journal as no_emitting_harness", () => {
    const report = analyzeRequirementLinkability({ requirements, evidenceRecords: evidence });
    const entry = report.entries.find((e) => e.requirementId === "req-no-emitter");
    expect(entry?.status).toBe(
      "unlinkable_no_emitting_harness" satisfies RequirementLinkabilityStatus,
    );
    expect(entry?.observedGateTags).toEqual([]);
  });

  it("classifies a tagless criterion that DID match a rule as the umbrella case", () => {
    const report = analyzeRequirementLinkability({
      requirements,
      evidenceRecords: evidence,
      hasTagRule: () => true,
    });
    const entry = report.entries.find((e) => e.requirementId === "req-umbrella");
    expect(entry?.status).toBe("unlinkable_umbrella" satisfies RequirementLinkabilityStatus);
  });

  it("classifies a tagless criterion that matched NO rule as a tagging gap, not the umbrella", () => {
    const report = analyzeRequirementLinkability({
      requirements,
      evidenceRecords: evidence,
      hasTagRule: () => false,
    });
    const entry = report.entries.find((e) => e.requirementId === "req-umbrella");
    expect(entry?.status).toBe("unlinkable_no_tag_rule" satisfies RequirementLinkabilityStatus);
  });

  /**
   * PINS THE PRODUCTION DEFAULT. Every other test of the umbrella /
   * no_tag_rule split injects `hasTagRule`, so `analyzeRequirementLinkability`'s
   * own `?? hasCriterionTagRule` fallback was exercised by nothing: replacing
   * it with `?? (() => true)` kept the whole suite green while collapsing a
   * genuine wiring bug ("nobody tagged this roadmap bullet") into
   * "structurally unlinkable by design ... Not a defect" — precisely the
   * collapse this module's doc comment says it exists to prevent. These two
   * tests call it WITHOUT the override, one on each side of the real rule
   * table.
   */
  it("with NO hasTagRule override, a tagless criterion matching no real rule is a tagging gap", () => {
    const report = analyzeRequirementLinkability({
      requirements: [
        {
          id: "req-untagged",
          text: "a criterion nobody has ever written a tag rule for",
          gateTags: [],
        },
      ],
      evidenceRecords: [],
    });
    expect(report.entries[0]?.status).toBe(
      "unlinkable_no_tag_rule" satisfies RequirementLinkabilityStatus,
    );
  });

  it("with NO hasTagRule override, the REAL umbrella wording is still the umbrella", () => {
    const report = analyzeRequirementLinkability({
      requirements: [
        {
          id: "req-umbrella-real",
          text: "archived `e2e/release-gate-report.json` shows PASS for every item below",
          gateTags: [],
        },
      ],
      evidenceRecords: [],
    });
    expect(report.entries[0]?.status).toBe(
      "unlinkable_umbrella" satisfies RequirementLinkabilityStatus,
    );
  });

  it("counts linked/unlinkable so they always sum to the corpus size", () => {
    const report = analyzeRequirementLinkability({ requirements, evidenceRecords: evidence });
    expect(report.corpusSize).toBe(4);
    expect(report.linked).toBe(1);
    expect(report.unlinkable).toBe(3);
    expect(report.linked + report.unlinkable).toBe(report.corpusSize);
  });

  it("reports every gate tag observed in the journal that carries no requirementId anywhere", () => {
    const report = analyzeRequirementLinkability({ requirements, evidenceRecords: evidence });
    expect(report.unstampedGateTags).toEqual(["release-gate:beta"]);
  });

  it("does NOT report a tag as unstamped when at least one record under it carries a requirementId", () => {
    const report = analyzeRequirementLinkability({
      requirements,
      evidenceRecords: [
        ...evidence,
        record({ id: "e3", gateTag: "release-gate:beta", requirementId: "req-unstamped" }),
      ],
    });
    expect(report.unstampedGateTags).toEqual([]);
  });

  it("ignores records with no gateTag at all when deriving observed tags", () => {
    const report = analyzeRequirementLinkability({
      requirements,
      evidenceRecords: [record({ id: "e4" })],
    });
    expect(report.unstampedGateTags).toEqual([]);
    expect(report.linked).toBe(0);
  });

  it("summarizes the arithmetic as one quotable line naming every bucket", () => {
    const report = analyzeRequirementLinkability({ requirements, evidenceRecords: evidence });
    const line = summarizeRequirementLinkability(report);
    expect(line).toContain("4 requirement(s)");
    expect(line).toContain("1 linked");
    expect(line).toContain("3 unlinkable");
    expect(line).toContain("unstamped_emitter=1");
    expect(line).toContain("no_emitting_harness=1");
  });
});

describe("the REAL release corpus — the arithmetic WP4 demands, derived rather than asserted", () => {
  it("derives 16 requirements from roadmap/23's own exit-criteria bullets", () => {
    expect(readReleaseRequirements(REPO_ROOT)).toHaveLength(16);
  });

  it("has exactly one criterion that matches a tag rule yet carries no tags (the umbrella)", () => {
    const requirements = readReleaseRequirements(REPO_ROOT);
    const tagless = requirements.filter((r) => r.gateTags.length === 0);
    expect(tagless).toHaveLength(1);
    expect(tagless.every((r) => hasCriterionTagRule(r.text))).toBe(true);
  });

  it("every other criterion matched a tag rule — no roadmap bullet is silently untagged", () => {
    const requirements = readReleaseRequirements(REPO_ROOT);
    expect(requirements.filter((r) => !hasCriterionTagRule(r.text))).toEqual([]);
  });

  it("hasCriterionTagRule genuinely discriminates — an unrecognised criterion is FALSE", () => {
    // Without this negative case the assertion above passes vacuously for a
    // `hasCriterionTagRule` that just returns `true`.
    expect(hasCriterionTagRule("a criterion nobody has ever written a tag rule for")).toBe(false);
    expect(hasCriterionTagRule("Reproducible build: two independent from-clean-checkout")).toBe(
      true,
    );
  });

  it("with ONLY the 7 attestation tags stamped, exactly 9 of 16 requirements cannot link", () => {
    const requirements = readReleaseRequirements(REPO_ROOT);
    const evidenceRecords = ATTESTATION_GATE_TAGS.map((tag, i) =>
      record({
        id: `00000000-0000-4000-8000-00000000001${i}`,
        gateTag: tag,
        ...(requirements.find((r) => r.gateTags.includes(tag))?.id !== undefined
          ? { requirementId: requirements.find((r) => r.gateTags.includes(tag))?.id }
          : {}),
      }),
    );
    const report = analyzeRequirementLinkability({ requirements, evidenceRecords });
    expect(report.corpusSize).toBe(16);
    expect(report.linked).toBe(7);
    expect(report.unlinkable).toBe(9);
    // The nine break down into ONE umbrella criterion (structurally
    // unlinkable — it maps to `tags: []` by design) and eight whose tags
    // simply have no requirementId-stamping emitter in this journal.
    expect(report.byStatus.unlinkable_umbrella).toBe(1);
    expect(report.byStatus.unlinkable_no_tag_rule).toBe(0);
    expect(
      report.byStatus.unlinkable_no_emitting_harness + report.byStatus.unlinkable_unstamped_emitter,
    ).toBe(8);
  });
});
