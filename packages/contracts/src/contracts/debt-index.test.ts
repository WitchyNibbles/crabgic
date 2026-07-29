import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "./review-verdict.js";
import { reclassifyDebtForWriteSet, selectDebtTouchedBy } from "./debt-index.js";

/**
 * Owner ruling 2026-07-29 (§7.3 of `docs/staged-review-pipeline.md`): an
 * advisory finding deferred as `accepted-debt` becomes `blocking` the moment a
 * later change set's planned writes intersect the paths it concerns.
 *
 * Debt is therefore paid at the cheapest moment — when the context is already
 * loaded — and nothing accumulates silently.
 */

function debt(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    claim: "the sweep cursor is world-writable",
    evidence: {
      reproduction: "ln -s victim $TMPDIR/.cursor",
      observed: "clobbered",
      expected: "refused",
    },
    verification: "confirmed",
    classification: "advisory",
    disposition: "accepted-debt",
    dispositionEvidence: "narrow: needs local write access",
    paths: ["packages/cli/src/doctor"],
    ...overrides,
  } as ReviewFinding;
}

describe("selectDebtTouchedBy", () => {
  it("selects debt whose directory contains a planned write", () => {
    const touched = selectDebtTouchedBy([debt()], ["packages/cli/src/doctor/checks/sandbox.ts"]);
    expect(touched).toHaveLength(1);
  });

  it("selects debt on the exact file being written", () => {
    const finding = debt({ paths: ["packages/cli/src/doctor/checks/sandbox.ts"] });
    expect(
      selectDebtTouchedBy([finding], ["packages/cli/src/doctor/checks/sandbox.ts"]),
    ).toHaveLength(1);
  });

  it("does NOT select a sibling whose name merely shares a prefix", () => {
    // Segment-aware containment, the same rule the envelope policy uses:
    // `src` contains `src/login` and does not contain `srcfoo`. A prefix match
    // on raw strings is the confinement bug this repo already paid for once.
    const finding = debt({ paths: ["packages/cli/src/doc"] });
    expect(selectDebtTouchedBy([finding], ["packages/cli/src/doctor/checks/sandbox.ts"])).toEqual(
      [],
    );
  });

  it("selects debt when the write is the ancestor and the debt is beneath it", () => {
    // A change set rewriting a whole directory touches everything under it.
    const finding = debt({ paths: ["packages/cli/src/doctor/checks/sandbox.ts"] });
    expect(selectDebtTouchedBy([finding], ["packages/cli/src/doctor"])).toHaveLength(1);
  });

  it("ignores findings that are not accepted debt", () => {
    // Fixed and refuted findings are answered; they never come back.
    for (const disposition of ["fixed", "refuted"] as const) {
      const finding = debt({ disposition, dispositionEvidence: "done" });
      expect(selectDebtTouchedBy([finding], ["packages/cli/src/doctor"])).toEqual([]);
    }
  });

  it("ignores untouched debt", () => {
    expect(selectDebtTouchedBy([debt()], ["packages/gates/src/drift/cli.ts"])).toEqual([]);
  });

  it("is empty for a change set that writes nothing", () => {
    expect(selectDebtTouchedBy([debt()], [])).toEqual([]);
  });
});

describe("reclassifyDebtForWriteSet", () => {
  it("turns touched debt into a blocking finding that names its criterion", () => {
    const [reopened] = reclassifyDebtForWriteSet([debt()], ["packages/cli/src/doctor/checks/x.ts"]);
    expect(reopened?.classification).toBe("blocking");
    // A blocking finding MUST name the criterion it violates, or the schema
    // refuses it -- so reopening supplies one rather than producing a finding
    // that cannot be represented.
    expect(reopened?.violates).toBeTruthy();
  });

  it("clears the disposition, because the debt is open again", () => {
    const [reopened] = reclassifyDebtForWriteSet([debt()], ["packages/cli/src/doctor/checks/x.ts"]);
    expect(reopened?.disposition).toBeUndefined();
    // And with it cleared, the stage cannot advance until it is answered again
    // -- which is the whole point of deferring rather than dropping.
  });

  it("leaves untouched debt exactly as it was", () => {
    const original = debt();
    const [untouched] = reclassifyDebtForWriteSet([original], ["packages/gates"]);
    expect(untouched).toEqual(original);
  });

  it("preserves the original evidence, so the reopened finding is still falsifiable", () => {
    const [reopened] = reclassifyDebtForWriteSet([debt()], ["packages/cli/src/doctor"]);
    expect(reopened?.evidence.reproduction).toBe("ln -s victim $TMPDIR/.cursor");
  });
});
