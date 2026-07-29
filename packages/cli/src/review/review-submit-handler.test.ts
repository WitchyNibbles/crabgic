import { describe, expect, it } from "vitest";
import { exitCriteriaFor, type ReviewFinding } from "@crabgic/contracts";
import { runReviewSubmit, type ReviewSubmitDeps } from "./review-submit-handler.js";

/**
 * `review.submit` — ledger Gap 20's wiring.
 *
 * Gap 20 recorded the enforcement layer as "correct, tested, and unwired",
 * which makes it a contract the manager MAY follow rather than one it must.
 * This is the surface that makes it must: closure is computed **server-side**
 * from the findings on record, so a manager cannot assert that a stage is done
 * any more than it can mint its own approval token.
 *
 * Same principle as `contract.approve`, applied to review — adaptation §5.5,
 * "the model must not be able to satisfy its own approval gate".
 */

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    claim: "a FIFO at the state path blocks forever",
    evidence: { reproduction: "mkfifo …", observed: "hangs", expected: "a diagnosis" },
    verification: "confirmed",
    classification: "advisory",
    disposition: "accepted-debt",
    dispositionEvidence: "narrow threat model",
    paths: ["packages/cli/src/doctor"],
    ...overrides,
  } as ReviewFinding;
}

function verdict(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "22222222-2222-4222-8222-222222222222",
    createdAt: "2026-07-29T00:00:00.000Z",
    stage: "implement",
    artifactRef: "changeset:abc",
    lens: "security",
    verdict: "revise",
    round: 1,
    findings: [],
    ...overrides,
  };
}

function deps(overrides: Partial<ReviewSubmitDeps> = {}): ReviewSubmitDeps {
  const appended: unknown[] = [];
  return {
    appendEvidence: (record) => {
      appended.push(record);
      return Promise.resolve();
    },
    priorFindings: () => [],
    plannedWrites: () => [],
    metCriteria: () => exitCriteriaFor("implement"),
    ...overrides,
    // Exposed for assertions without widening the production interface.
    ...({ _appended: appended } as Partial<ReviewSubmitDeps>),
  };
}

describe("runReviewSubmit — the document must be valid", () => {
  it("rejects a verdict that is not a ReviewVerdict at all", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: { nonsense: true } },
      deps(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/verdict/i);
  });

  it("rejects a blocking finding that names no exit criterion", async () => {
    // Enforced by the schema, and re-asserted here because this is the surface
    // an actual reviewer reaches. A rule enforced only in a library nobody
    // calls is the situation Gap 20 was raised about.
    const bad = finding({ classification: "blocking", violates: undefined });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ findings: [bad] }) },
      deps(),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects `approve` submitted over an unresolved blocking finding", async () => {
    const open = finding({
      classification: "blocking",
      violates: "implement-gates-pass",
      disposition: undefined,
      dispositionEvidence: undefined,
    });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ verdict: "approve", findings: [open] }) },
      deps(),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown stage rather than closing it vacuously", async () => {
    const result = await runReviewSubmit({ stage: "nonsense", verdict: verdict() }, deps());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown stage/i);
  });
});

describe("runReviewSubmit — closure is computed, never asserted", () => {
  it("closes a stage when its criteria are met and nothing blocks", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ verdict: "approve" }) },
      deps(),
    );
    expect(result.ok).toBe(true);
    expect(result.stageClosable).toBe(true);
  });

  it("does NOT close when a criterion is unmet, even on an approving verdict", async () => {
    // The property the superseded loop lacked. A reviewer saying yes is not the
    // same as the artifact meeting its criteria, and only one of those is
    // checkable.
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ verdict: "approve" }) },
      deps({ metCriteria: () => ["implement-gates-pass"] }),
    );
    expect(result.ok).toBe(true);
    expect(result.stageClosable).toBe(false);
    expect(result.unmetCriteria).toContain("implement-tests-first");
  });

  it("counts PRIOR findings, not just this round's", async () => {
    // A reviewer submitting a clean round does not erase an open blocker
    // someone else raised. Closure is over everything on record.
    const open = finding({
      classification: "blocking",
      violates: "implement-gates-pass",
      disposition: undefined,
      dispositionEvidence: undefined,
    });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ verdict: "approve" }) },
      deps({ priorFindings: () => [open] }),
    );
    expect(result.stageClosable).toBe(false);
    expect(result.openBlocking).toBe(1);
  });

  it("does not close while any finding is undispositioned, at any severity", async () => {
    const unanswered = finding({ disposition: undefined, dispositionEvidence: undefined });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ verdict: "revise", findings: [unanswered] }) },
      deps(),
    );
    expect(result.stageClosable).toBe(false);
    expect(result.undispositioned).toBe(1);
  });
});

describe("runReviewSubmit — debt reopens against planned writes", () => {
  it("reopens deferred debt the change set touches, and blocks on it", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ verdict: "approve" }) },
      deps({
        priorFindings: () => [finding()],
        plannedWrites: () => ["packages/cli/src/doctor/checks/sandbox.ts"],
      }),
    );
    expect(result.stageClosable).toBe(false);
    expect(result.reopenedDebt).toBe(1);
  });

  it("leaves debt alone when the change set touches other code", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ verdict: "approve" }) },
      deps({
        priorFindings: () => [finding()],
        plannedWrites: () => ["packages/gates/src/drift/cli.ts"],
      }),
    );
    expect(result.stageClosable).toBe(true);
    expect(result.reopenedDebt).toBe(0);
  });
});

describe("runReviewSubmit — the round budget", () => {
  it("says to escalate when a round closes no blocking finding", async () => {
    // The progress rule (owner ruling §7.1). Derived from dispositions, never
    // from the reviewer's own account of its progress -- a reviewer scoring
    // itself is the sycophancy failure inverted.
    const open = finding({
      classification: "blocking",
      violates: "implement-gates-pass",
      disposition: undefined,
      dispositionEvidence: undefined,
    });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ round: 2, findings: [] }) },
      deps({ priorFindings: () => [open] }),
    );
    expect(result.escalate).toBe(true);
    expect(result.escalationReason).toMatch(/irreducible_product_decision/);
  });

  it("does not escalate on a round that closed something", async () => {
    const closed = finding({
      classification: "blocking",
      violates: "implement-gates-pass",
      disposition: "fixed",
      dispositionEvidence: "closed by the O_NONBLOCK change",
    });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ round: 2, findings: [closed] }) },
      deps(),
    );
    expect(result.escalate).toBe(false);
  });
});

describe("runReviewSubmit — every verdict is journaled", () => {
  it("appends an EvidenceRecord even for a rejected stage", async () => {
    const appended: unknown[] = [];
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ verdict: "approve" }) },
      deps({
        appendEvidence: (record) => {
          appended.push(record);
          return Promise.resolve();
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(appended).toHaveLength(1);
  });

  it("does NOT journal a document that failed validation", async () => {
    // An invalid verdict is not a review that happened; journaling it would
    // put a record on the audit trail that no reviewer stands behind.
    const appended: unknown[] = [];
    await runReviewSubmit(
      { stage: "implement", verdict: { nonsense: true } },
      deps({
        appendEvidence: (record) => {
          appended.push(record);
          return Promise.resolve();
        },
      }),
    );
    expect(appended).toEqual([]);
  });
});
