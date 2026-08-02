/**
 * Unit tests for the frozen-baseline generator.
 *
 * The baseline is the only anchor that lives outside the commit under review,
 * so the two things that make it trustworthy — that its hashes come from a
 * revision predating the closeout, and that the committed manifest still
 * re-derives from the pinned revisions — are exactly the code that must not be
 * taken on trust. Both were verified only by hand until an adversarial review
 * pointed out they had no tests at all.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { baselineEntryFor, diffAgainstCommitted } from "./generate-criteria-baseline.mjs";

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const PIN = { rev: "a".repeat(40), note: "fixture pin" };
const FILE = "roadmap/99-fixture.md";

const phaseFile = (...boxes) =>
  ["## Exit criteria", "", ...boxes, "", "## Risks", "", "- none", ""].join("\n");

describe("baselineEntryFor", () => {
  it("hashes each criterion's whitespace-normalized wording, in file order", () => {
    const entry = baselineEntryFor(FILE, PIN, phaseFile("- [ ] First one.", "- [ ] Second one."));
    expect(entry).toEqual({
      roadmapFile: FILE,
      sourceRev: PIN.rev,
      sourceNote: PIN.note,
      criteria: [sha256("First one."), sha256("Second one.")],
    });
  });

  it("hashes a hard-wrapped criterion the same as its one-line form", () => {
    const wrapped = baselineEntryFor(FILE, PIN, phaseFile("- [ ] First", "      one."));
    expect(wrapped.criteria).toEqual([sha256("First one.")]);
  });

  /**
   * THE load-bearing assertion. If a pinned revision already carries the
   * closeout annotation then it is not pre-closeout, and every hash derived
   * from it would be laundered wording presented as original wording — the
   * baseline would certify the very edit it exists to detect.
   */
  it("refuses a revision whose checkboxes already carry the closeout annotation", () => {
    expect(() =>
      baselineEntryFor(
        FILE,
        PIN,
        phaseFile("- [x] First one. — **Evidence (2026-08-01):** cited."),
      ),
    ).toThrow(/not pre-closeout/);
  });

  it("refuses a phase file with no exit criteria at all", () => {
    expect(() => baselineEntryFor(FILE, PIN, "# Nothing here\n")).toThrow(/no "## Exit criteria"/);
  });

  it("refuses a phase file the parser does not trust — a decoy section is not a baseline source", () => {
    expect(() =>
      baselineEntryFor(
        FILE,
        PIN,
        [
          "## Exit criteria",
          "",
          "- [ ] Real.",
          "",
          "## Exit criteria",
          "",
          "- [ ] Decoy.",
          "",
        ].join("\n"),
      ),
    ).toThrow(/headings/);
  });
});

describe("diffAgainstCommitted", () => {
  const derived = {
    phases: {
      "03": { roadmapFile: "roadmap/03-x.md", sourceRev: "b".repeat(40), criteria: ["h1", "h2"] },
    },
  };
  const clone = () => JSON.parse(JSON.stringify(derived));

  it("passes when the committed manifest re-derives exactly", () => {
    expect(diffAgainstCommitted(derived, clone())).toEqual([]);
  });

  it("catches a hash edited in the committed manifest", () => {
    const committed = clone();
    committed.phases["03"].criteria[1] = "laundered";
    expect(diffAgainstCommitted(derived, committed).join("\n")).toContain("does not re-derive");
  });

  /**
   * Re-pinning is the sanctioned way to change a criterion, which is exactly
   * why it must be loud rather than silent.
   */
  it("catches a re-pinned sourceRev and names it a deliberate act", () => {
    const committed = clone();
    committed.phases["03"].sourceRev = "c".repeat(40);
    expect(diffAgainstCommitted(derived, committed).join("\n")).toContain("deliberate act");
  });

  it("catches a phase dropped from the committed manifest", () => {
    expect(diffAgainstCommitted(derived, { phases: {} }).join("\n")).toContain("missing");
  });

  it("catches a phase invented in the committed manifest", () => {
    const committed = clone();
    committed.phases["77"] = { roadmapFile: "roadmap/77-invented.md", criteria: [] };
    expect(diffAgainstCommitted(derived, committed).join("\n")).toContain("not a roadmap phase");
  });

  it("catches criteria added to or removed from the committed manifest", () => {
    const committed = clone();
    committed.phases["03"].criteria = ["h1"];
    expect(diffAgainstCommitted(derived, committed).join("\n")).toContain("criteria");
  });
});
