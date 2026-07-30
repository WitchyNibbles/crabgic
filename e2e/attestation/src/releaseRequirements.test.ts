import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IdSchema } from "@crabgic/contracts";
import {
  buildReleaseRequirements,
  deriveRequirementId,
  gateTagsForCriterion,
  parseExitCriteria,
  readReleaseRequirements,
  requirementIdForGateTag,
  requiresRemoteBinding,
} from "./releaseRequirements.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SECTION = [
  "# t",
  "",
  "## Exit criteria",
  "",
  "- [ ] Performance contracts satisfied rather than skipped, measured on a quiet host (15).",
  "- [x] ARM64 build+test verified on real hardware/CI,",
  "      or an explicitly documented substitute recorded.",
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

  it("JOINS a multi-line bullet's indented continuation into one criterion text", () => {
    // A line-based parser silently truncated the sole multi-line exit
    // criterion (the 8-family gateway bullet), losing the phrase its tag rule
    // matches AND changing its derived id. A multi-line criterion must read as
    // ONE space-joined text so its `deriveRequirementId` is stable.
    const criteria = parseExitCriteria(SECTION);
    expect(criteria[1]).toBe(
      "ARM64 build+test verified on real hardware/CI, or an explicitly documented substitute recorded.",
    );
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

/**
 * The owner-ratified scope of roadmap/23:125's remote-revision half. These
 * assertions run against the REAL roadmap corpus, not a fixture, so a
 * reworded criterion silently falling out of scope goes red here.
 */
describe("requiresRemoteBinding — scoped to criteria with a remote subject", () => {
  const requirements = readReleaseRequirements(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."),
  );

  it("finds the real corpus", () => {
    expect(requirements.length).toBeGreaterThan(0);
  });

  it("requires a remote binding of the two criteria that name a remote system", () => {
    const scoped = requirements.filter((requirement) => requirement.requiresRemoteBinding);
    expect(scoped).toHaveLength(2);
    expect(scoped.map((requirement) => requirement.text).join("\n")).toMatch(
      /Every requirement linked to evidence/,
    );
    expect(scoped.map((requirement) => requirement.text).join("\n")).toMatch(
      /exactly-once and read-back/,
    );
  });

  it("exempts the criteria that have no remote counterpart at all", () => {
    const exempt = requirements.filter((requirement) => !requirement.requiresRemoteBinding);
    const text = exempt.map((requirement) => requirement.text).join("\n");
    // Each of these is a purely local property of the release artifact.
    expect(text).toMatch(/Reproducible build/);
    expect(text).toMatch(/ARM64 build\+test verified/);
    expect(text).toMatch(/Performance contracts satisfied/);
  });

  it("is derived per criterion, never a blanket true or false", () => {
    expect(requiresRemoteBinding("Reproducible build: two independent builds")).toBe(false);
    expect(requiresRemoteBinding("Every requirement linked to evidence from the exact")).toBe(true);
  });
});
