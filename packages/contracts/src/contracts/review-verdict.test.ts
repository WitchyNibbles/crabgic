import { describe, expect, it } from "vitest";
import {
  FINDING_CLASSIFICATIONS,
  FINDING_DISPOSITIONS,
  FINDING_VERIFICATIONS,
  ReviewFindingSchema,
  ReviewVerdictSchema,
  type ReviewFinding,
  REVIEW_ROUND_CEILING,
  REVIEW_RUNAWAY_GUARD,
  REVIEW_VERDICTS,
  isStageClosable,
} from "./review-verdict.js";

/**
 * `ReviewVerdict` — interface-ledger Gap 19 as amended 2026-07-29, and the
 * enforcement layer for `docs/staged-review-pipeline.md`.
 *
 * The protocol text already SAYS all of this. Prose is not enforcement — the
 * same reason `hooks/stop-autonomy-gate.mjs` exists beside the protocol's
 * "never ask permission to keep going" paragraph. This schema is what makes
 * the parts that can be checked, checked.
 */

const FINDING = {
  id: "11111111-1111-4111-8111-111111111111",
  claim: "a FIFO at the cursor path blocks doctor forever",
  evidence: {
    reproduction: "mkfifo $TMPDIR/.eo-cursor && crabgic doctor",
    observed: "rc=137 after 36s, zero bytes of output",
    expected: "a diagnosis naming the FIFO",
  },
  verification: "confirmed",
  classification: "blocking",
  violates: "doctor-never-hangs",
  disposition: "fixed",
  dispositionEvidence: "closed by O_NONBLOCK; re-attacked, 2s / rc=2 / 1239 bytes",
  paths: ["packages/cli/src/doctor"],
} satisfies ReviewFinding;

const VERDICT = {
  schemaVersion: 1,
  id: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-07-29T00:00:00.000Z",
  stage: "implement",
  artifactRef: "changeset:abc",
  lens: "security",
  verdict: "revise",
  round: 1,
  findings: [FINDING],
};

describe("the vocabularies", () => {
  it("offers `approve` as a verdict, which is the whole amendment", () => {
    // The superseded charter told the reviewer never to approve, leaving it no
    // way to say done. A reviewer that cannot say done cannot end a review;
    // twelve rounds measured exactly that (docs/staged-review-pipeline.md §2).
    expect(REVIEW_VERDICTS).toContain("approve");
    expect(REVIEW_VERDICTS).toContain("revise");
  });

  it("has no disposition meaning `ignored`", () => {
    // The owner's constraint: known issues must not pass unvalidated or
    // unhandled. Every disposition is an ANSWER -- fixed, refuted, or accepted
    // with its reason -- so there is no member that means "filed and forgotten".
    expect([...FINDING_DISPOSITIONS].sort()).toEqual(["accepted-debt", "fixed", "refuted"]);
  });

  it("separates verification from classification", () => {
    // Whether a finding is TRUE and whether it BLOCKS are different questions.
    // Collapsing them is how a real defect gets dismissed for being minor, or a
    // taste preference gets treated as a defect for being loudly argued.
    expect([...FINDING_VERIFICATIONS].sort()).toEqual(["confirmed", "refuted", "unverified"]);
    expect([...FINDING_CLASSIFICATIONS].sort()).toEqual(["advisory", "blocking"]);
  });
});

describe("ReviewFindingSchema", () => {
  it("accepts a well-formed blocking finding", () => {
    expect(ReviewFindingSchema.parse(FINDING).classification).toBe("blocking");
  });

  /**
   * The rule that makes termination possible at all: a reviewer cannot hold a
   * stage open on a finding it cannot tie to a stated criterion. Enforced here
   * rather than trusted to the prose, because "names the criterion" is exactly
   * the kind of instruction a model satisfies loosely.
   */
  it("REFUSES a blocking finding that names no exit criterion", () => {
    const { violates: _dropped, ...withoutCriterion } = FINDING;
    const result = ReviewFindingSchema.safeParse({
      ...withoutCriterion,
      classification: "blocking",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toMatch(/exit criterion|violates/i);
    }
  });

  it("accepts an advisory finding with no criterion, since it blocks nothing", () => {
    const { violates: _dropped, ...withoutCriterion } = FINDING;
    const advisory = ReviewFindingSchema.parse({
      ...withoutCriterion,
      classification: "advisory",
      disposition: "accepted-debt",
      dispositionEvidence: "narrow: needs write access to a 0700 dir the owner already holds",
    });
    expect(advisory.violates).toBeUndefined();
  });

  it("REFUSES any finding whose disposition evidence is empty", () => {
    // `dispositionEvidence` can never be empty at any severity. This is the
    // field that stops `advisory` becoming a disposal route.
    for (const disposition of FINDING_DISPOSITIONS) {
      const result = ReviewFindingSchema.safeParse({
        ...FINDING,
        classification: "advisory",
        violates: undefined,
        disposition,
        dispositionEvidence: "   ",
      });
      expect(result.success).toBe(false);
    }
  });

  it("requires a reproduction, so a finding is falsifiable by construction", () => {
    const result = ReviewFindingSchema.safeParse({
      ...FINDING,
      evidence: { reproduction: "", observed: "x", expected: "y" },
    });
    expect(result.success).toBe(false);
  });

  it("keeps `accepted-debt` addressable by the paths it concerns", () => {
    // Debt turns blocking when a later change set touches that code, which is
    // only possible if the finding says which code it is about.
    const result = ReviewFindingSchema.safeParse({
      ...FINDING,
      classification: "advisory",
      violates: undefined,
      disposition: "accepted-debt",
      dispositionEvidence: "deferred: narrow threat model",
      paths: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("ReviewVerdictSchema", () => {
  it("accepts a well-formed verdict", () => {
    expect(ReviewVerdictSchema.parse(VERDICT).verdict).toBe("revise");
  });

  it("REFUSES `approve` while a blocking finding is still open", () => {
    // A reviewer approving over its own unresolved blocker is the failure this
    // whole amendment risks introducing, so it is unrepresentable rather than
    // discouraged.
    const result = ReviewVerdictSchema.safeParse({
      ...VERDICT,
      verdict: "approve",
      findings: [{ ...FINDING, disposition: "accepted-debt", dispositionEvidence: "later" }],
    });
    expect(result.success).toBe(false);
  });

  it("allows `approve` once every blocking finding is fixed or refuted", () => {
    const approved = ReviewVerdictSchema.parse({ ...VERDICT, verdict: "approve" });
    expect(approved.verdict).toBe("approve");
  });

  it("allows `approve` with no findings at all", () => {
    // "I attacked X, Y and Z and could not break them" is a complete answer.
    const clean = ReviewVerdictSchema.parse({ ...VERDICT, verdict: "approve", findings: [] });
    expect(clean.findings).toEqual([]);
  });

  it("allows a round past the superseded ceiling", () => {
    // AMENDED by owner ruling R4 (2026-08-15). The schema used to cap `round` at
    // REVIEW_ROUND_CEILING, which made round 6 unrepresentable -- so a stalling
    // stage could not report the state that triggers its own escalation, and the
    // guard was unreachable by construction. Closure is now the zero-findings
    // exit, and rounds are bounded by the runaway guard instead.
    const result = ReviewVerdictSchema.safeParse({ ...VERDICT, round: REVIEW_ROUND_CEILING + 1 });
    expect(result.success).toBe(true);
  });

  it("refuses a round past the runaway guard", () => {
    // The guard is still a hard bound on what can be represented -- a round
    // beyond it is not a review state the pipeline can reach.
    const result = ReviewVerdictSchema.safeParse({ ...VERDICT, round: REVIEW_RUNAWAY_GUARD + 1 });
    expect(result.success).toBe(false);
  });
});

describe("isStageClosable", () => {
  const criteria = ["doctor-never-hangs", "no-world-writable-state"];

  it("closes when criteria are met and nothing blocks", () => {
    expect(
      isStageClosable({ metCriteria: criteria, requiredCriteria: criteria, findings: [FINDING] }),
    ).toBe(true);
  });

  it("does NOT close while a criterion is unmet, even with zero findings", () => {
    // Termination is the artifact against its criteria -- never the reviewer
    // running out of things to say. A stage with a clean review and an unmet
    // criterion is not done.
    expect(
      isStageClosable({
        metCriteria: ["doctor-never-hangs"],
        requiredCriteria: criteria,
        findings: [],
      }),
    ).toBe(false);
  });

  it("does NOT close while a blocking finding is unresolved", () => {
    expect(
      isStageClosable({
        metCriteria: criteria,
        requiredCriteria: criteria,
        findings: [{ ...FINDING, disposition: "accepted-debt", dispositionEvidence: "later" }],
      }),
    ).toBe(false);
  });

  it("does NOT close while ANY finding is undispositioned, at any severity", () => {
    // The owner's constraint, enforced: a stage may not advance holding an
    // unhandled finding regardless of how minor it is.
    expect(
      isStageClosable({
        metCriteria: criteria,
        requiredCriteria: criteria,
        findings: [
          { ...FINDING, classification: "advisory", violates: undefined, disposition: undefined },
        ],
      }),
    ).toBe(false);
  });

  it("DOES close with advisory debt, which defers rather than blocks", () => {
    expect(
      isStageClosable({
        metCriteria: criteria,
        requiredCriteria: criteria,
        findings: [
          {
            ...FINDING,
            classification: "advisory",
            violates: undefined,
            disposition: "accepted-debt",
            dispositionEvidence: "narrow threat model; recorded",
          },
        ],
      }),
    ).toBe(true);
  });
});
