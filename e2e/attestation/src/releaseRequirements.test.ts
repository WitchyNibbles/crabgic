import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IdSchema } from "@eo/contracts";
import {
  buildReleaseRequirements,
  deriveRequirementId,
  gateTagsForCriterion,
  parseExitCriteria,
  readReleaseRequirements,
  requirementIdForGateTag,
} from "./releaseRequirements.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SECTION = [
  "# t",
  "",
  "## Exit criteria",
  "",
  "- [ ] Performance contracts satisfied rather than skipped, measured on a quiet host (15).",
  "- [x] ARM64 build+test verified on real hardware/CI, or a substitute recorded.",
  "  not a bullet",
  "",
  "## Risks",
  "",
  "- [ ] should not be picked up",
].join("\n");

describe("parseExitCriteria", () => {
  it("extracts checkbox bullets, checked or not, and stops at the next section", () => {
    const criteria = parseExitCriteria(SECTION);
    expect(criteria).toHaveLength(2);
    expect(criteria[0]).toContain("Performance contracts satisfied");
    expect(criteria.join(" ")).not.toContain("should not be picked up");
  });

  it("returns nothing when the section is absent rather than guessing", () => {
    expect(parseExitCriteria("# t\n\nno exit criteria here")).toEqual([]);
  });
});

describe("deriveRequirementId", () => {
  it("produces a real UUID, because EvidenceRecord.requirementId is IdSchema", () => {
    expect(() => IdSchema.parse(deriveRequirementId("some criterion"))).not.toThrow();
  });

  it("is deterministic across calls, so a requirement keeps its identity", () => {
    expect(deriveRequirementId("same text")).toBe(deriveRequirementId("same text"));
  });

  it("distinguishes different criteria", () => {
    expect(deriveRequirementId("a")).not.toBe(deriveRequirementId("b"));
  });
});

describe("gateTagsForCriterion", () => {
  it("maps a criterion to the tags whose evidence satisfies it", () => {
    expect(gateTagsForCriterion("Performance contracts satisfied rather than skipped")).toContain(
      "release-gate:performance-contracts",
    );
  });

  /** The wording and the slug are not mechanically related — this is why the map is explicit. */
  it("maps the checkout-mutation criterion to its differently-named slug", () => {
    expect(
      gateTagsForCriterion("No user checkout, remote Git repository, or unauthorized provider"),
    ).toContain("release-gate:no-unauthorized-mutation");
  });

  it("returns no tags for an unrecognised criterion rather than guessing one", () => {
    expect(gateTagsForCriterion("something entirely new")).toEqual([]);
  });
});

describe("buildReleaseRequirements / requirementIdForGateTag", () => {
  it("gives every requirement a stable id and its tag set", () => {
    const requirements = buildReleaseRequirements(parseExitCriteria(SECTION));
    expect(requirements).toHaveLength(2);
    for (const requirement of requirements) {
      expect(() => IdSchema.parse(requirement.id)).not.toThrow();
    }
  });

  it("resolves a gate tag back to the requirement it evidences", () => {
    const requirements = buildReleaseRequirements(parseExitCriteria(SECTION));
    const id = requirementIdForGateTag(requirements, "release-gate:performance-contracts");
    expect(id).toBe(requirements[0]?.id);
  });

  it("returns undefined for a tag no requirement claims", () => {
    const requirements = buildReleaseRequirements(parseExitCriteria(SECTION));
    expect(requirementIdForGateTag(requirements, "release-gate:nonexistent")).toBeUndefined();
  });
});

describe("readReleaseRequirements — against the real roadmap", () => {
  it("derives the corpus from roadmap/23's own exit criteria", () => {
    const requirements = readReleaseRequirements(REPO_ROOT);
    // roadmap/23 lists the umbrella bullet plus the 15 scored items.
    expect(requirements.length).toBeGreaterThanOrEqual(15);
    for (const requirement of requirements) {
      expect(() => IdSchema.parse(requirement.id)).not.toThrow();
      expect(requirement.text.length).toBeGreaterThan(0);
    }
  });

  it("leaves no criterion unmapped except the umbrella one", () => {
    const requirements = readReleaseRequirements(REPO_ROOT);
    const unmapped = requirements.filter((requirement) => requirement.gateTags.length === 0);
    // Exactly one: the umbrella bullet, which is ABOUT the report rather
    // than evidenced by a gate tag of its own.
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]?.text).toContain("release-gate-report.json");
  });
});
