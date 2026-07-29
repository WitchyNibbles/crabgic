import { describe, expect, it } from "vitest";
import {
  DesignRecordSchema,
  exitCriteriaFor,
  type CriterionAttestation,
  type ReviewFinding,
} from "@crabgic/contracts";
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

/**
 * The implement stage's one JUDGED criterion, attested.
 *
 * A bare `metCriteria` string no longer establishes a judged criterion, so a test
 * asserting that a stage CLOSES has to say who judged it and why — which is the
 * point of the change rather than an inconvenience of it.
 */
function doneCriteriaAttestation(round = 1): CriterionAttestation {
  return {
    criterion: "implement-task-done-criteria-met",
    asserter: "eo-reviewer:correctness",
    rationale: "each stated done-criterion is demonstrated by a named test in this change set",
    artifactAnchor: "packages/cli/src/review/review-submit-handler.test.ts",
    assertedAt: "2026-07-29T00:00:00.000Z",
    round,
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
    calibration: () => ({
      calibrated: false,
      kappa: 0,
      kappaLowerBound: 0,
      sampleSize: 0,
      samplesNeeded: 20,
      verdictReason: "nobody has classified a finding against this classifier yet",
    }),
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
      {
        stage: "implement",
        verdict: verdict({ verdict: "approve" }),
        attestations: [doneCriteriaAttestation()],
      },
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
      {
        stage: "implement",
        verdict: verdict({ verdict: "approve" }),
        attestations: [doneCriteriaAttestation()],
      },
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

describe("runReviewSubmit — what the caller persists", () => {
  it("returns the finding set the decision was computed from", async () => {
    // Not the submitted set: the merged one, after prior findings and reopened
    // debt. A caller that persisted its own idea of the findings would be
    // storing something other than what was judged.
    const open = finding({
      id: "33333333-3333-4333-8333-333333333333",
      classification: "blocking",
      violates: "implement-gates-pass",
      disposition: undefined,
      dispositionEvidence: undefined,
    });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ findings: [finding()] }) },
      deps({ priorFindings: () => [open] }),
    );
    expect(result.findings).toHaveLength(2);
  });
});

describe("runReviewSubmit — the classifier's own trustworthiness", () => {
  it("reports calibration on every successful result, never omits it", async () => {
    // The split decides what holds a stage open. A consumer acting on it
    // deserves to know whether anyone has ever checked it, and an absent field
    // would read as "fine" when the honest answer is "nobody has looked".
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ verdict: "approve" }) },
      deps(),
    );
    expect(result.calibration).toBeDefined();
    expect(result.calibration?.calibrated).toBe(false);
    expect(result.calibration?.samplesNeeded).toBeGreaterThan(0);
  });
});

/**
 * `no-open-debt-in-touched-paths`, derived rather than believed.
 *
 * This criterion was arriving in `metCriteria` as a caller-supplied string while
 * the server was ALREADY computing the answer one line away: it reopens touched
 * debt from the durable finding set and the ChangeSet's own envelope
 * `ownedPaths`, then counts what it reopened. Asking the caller was asking a
 * question the server had already answered better.
 *
 * The caller's claim is stripped, not merged, so a submission asserting the
 * criterion over debt it is about to touch does not benefit from asserting it.
 */
describe("runReviewSubmit — deriving no-open-debt-in-touched-paths", () => {
  const DEBT_CRITERION = "no-open-debt-in-touched-paths";

  it("reports the criterion unmet when the change set touches accepted debt, even though the caller claimed it", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict() },
      deps({
        priorFindings: () => [finding({ paths: ["packages/cli/src/doctor"] })],
        plannedWrites: () => ["packages/cli/src/doctor/checks.ts"],
        metCriteria: () => exitCriteriaFor("implement"),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.unmetCriteria).toContain(DEBT_CRITERION);
    expect(result.stageClosable).toBe(false);
  });

  it("reports it met when no planned write touches any accepted debt", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict() },
      deps({
        priorFindings: () => [finding({ paths: ["packages/cli/src/doctor"] })],
        plannedWrites: () => ["packages/gates/src/flake-gate.ts"],
      }),
    );
    expect(result.unmetCriteria).not.toContain(DEBT_CRITERION);
  });

  /**
   * The claim is stripped even when it happens to be RIGHT, so the answer always
   * comes from the same place. A criterion that is derived on some submissions
   * and believed on others is not derived.
   */
  it("reports it met on the derivation alone, when the caller never claimed it", async () => {
    const claimedWithoutDebt = exitCriteriaFor("implement").filter((c) => c !== DEBT_CRITERION);
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict() },
      deps({
        priorFindings: () => [],
        plannedWrites: () => ["packages/gates/src/flake-gate.ts"],
        metCriteria: () => claimedWithoutDebt,
      }),
    );
    expect(result.unmetCriteria).not.toContain(DEBT_CRITERION);
  });

  /**
   * Debt reopened by an EARLIER round is still open now. `reclassifyDebtForWriteSet`
   * CLEARS the disposition when it reopens, so such a finding no longer looks like
   * `accepted-debt` to the touched-debt query — it is a blocking finding naming
   * this criterion. Reading only the query would report the criterion met while a
   * finding on record says it is violated.
   */
  it("reports it unmet while a previously reopened debt finding is still unresolved", async () => {
    const reopened = finding({
      id: "33333333-3333-4333-8333-333333333333",
      classification: "blocking",
      violates: DEBT_CRITERION,
      disposition: undefined,
      dispositionEvidence: undefined,
      paths: ["packages/cli/src/doctor"],
    });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict() },
      deps({
        priorFindings: () => [reopened],
        // Nothing touches its paths this time, so the query alone finds nothing.
        plannedWrites: () => ["packages/gates/src/flake-gate.ts"],
      }),
    );
    expect(result.unmetCriteria).toContain(DEBT_CRITERION);
  });

  it("stops reporting it unmet once that reopened debt is fixed", async () => {
    const paid = finding({
      id: "33333333-3333-4333-8333-333333333333",
      classification: "blocking",
      violates: DEBT_CRITERION,
      disposition: "fixed",
      dispositionEvidence: "packages/cli/src/doctor/checks.ts now refuses a FIFO",
      paths: ["packages/cli/src/doctor"],
    });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict() },
      deps({
        priorFindings: () => [paid],
        plannedWrites: () => ["packages/gates/src/flake-gate.ts"],
      }),
    );
    expect(result.unmetCriteria).not.toContain(DEBT_CRITERION);
  });
});

/**
 * JUDGED CRITERIA NOW NEED AN ATTRIBUTED CLAIM.
 *
 * Four criteria are derived from evidence and cannot be claimed. The rest are
 * judgements no tool can settle — and they were arriving as bare strings in
 * `metCriteria`, which is the weakest form a claim can take: nobody said it,
 * nothing points at what it describes, and a misreport leaves no trace.
 *
 * The criterion stays undecidable. The CLAIM does not have to stay anonymous, and
 * making it attributable is the reachable half. A bare string no longer counts,
 * and it is reported back by name rather than silently ignored — a caller using
 * the old shape gets told, instead of watching a criterion mysteriously stay unmet.
 */
describe("runReviewSubmit — attested judged criteria", () => {
  const JUDGED = "implement-task-done-criteria-met";

  function attestation(overrides: Record<string, unknown> = {}) {
    return {
      criterion: JUDGED,
      asserter: "eo-reviewer:correctness",
      rationale: "the task's stated done-criteria are each demonstrated by a named test",
      artifactAnchor: "packages/cli/src/review/gate-criteria.test.ts",
      assertedAt: "2026-07-29T00:00:00.000Z",
      round: 1,
      ...overrides,
    };
  }

  /** Every judged criterion asserted the old way, and none of them count. */
  it("does not count a bare metCriteria string, and names it back to the caller", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict() },
      deps({ metCriteria: () => [JUDGED] }),
    );

    expect(result.ok).toBe(true);
    expect(result.unmetCriteria).toContain(JUDGED);
    expect(result.unattestedCriteria).toContain(JUDGED);
  });

  it("counts the same criterion once it carries an attributed claim", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict(), attestations: [attestation()] },
      deps({ metCriteria: () => [] }),
    );
    expect(result.unmetCriteria).not.toContain(JUDGED);
    expect(result.unattestedCriteria ?? []).not.toContain(JUDGED);
  });

  it("refuses an attestation that is not a well-formed claim", async () => {
    const result = await runReviewSubmit(
      {
        stage: "implement",
        verdict: verdict(),
        attestations: [attestation({ rationale: "" })],
      },
      deps(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/attestation/i);
  });

  /**
   * An attestation for a criterion the SERVER derives is discarded rather than
   * honoured — and reported, because a caller attesting one has misunderstood
   * something worth telling it about. Silently accepting it would let a judgement
   * override evidence, which is the derivation running backwards.
   */
  it("discards an attestation for a criterion it derives for itself, and says so", async () => {
    const result = await runReviewSubmit(
      {
        stage: "implement",
        verdict: verdict(),
        attestations: [attestation({ criterion: "implement-gates-pass" })],
      },
      deps({ metCriteria: () => [] }),
    );

    expect(result.ok).toBe(true);
    expect(result.unmetCriteria).toContain("implement-gates-pass");
    expect(result.ignoredAttestations).toContainEqual({
      criterion: "implement-gates-pass",
      reason: "derived from evidence server-side; an attestation cannot override it",
    });
  });

  it("discards an attestation for a criterion the stage does not require", async () => {
    const result = await runReviewSubmit(
      {
        stage: "implement",
        verdict: verdict(),
        attestations: [attestation({ criterion: "design-risks-have-mitigations" })],
      },
      deps(),
    );
    expect(result.ok).toBe(true);
    expect(result.ignoredAttestations?.[0]?.criterion).toBe("design-risks-have-mitigations");
    expect(result.ignoredAttestations?.[0]?.reason).toMatch(/implement/);
  });

  /**
   * THE TEETH. An attestation is VOID while a finding on record says the criterion
   * is violated. This is the one contradiction a tool can catch without deciding
   * the criterion itself: two claims about the same criterion, one of them
   * falsifiable and unresolved.
   *
   * Closure was already blocked by the open blocker, but `unmetCriteria` would
   * have reported the criterion MET — a report contradicting the record it was
   * computed from.
   */
  it("voids an attestation contradicted by an unresolved blocking finding", async () => {
    const contradicting = finding({
      id: "44444444-4444-4444-8444-444444444444",
      classification: "blocking",
      violates: JUDGED,
      disposition: undefined,
      dispositionEvidence: undefined,
    });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict(), attestations: [attestation()] },
      deps({ priorFindings: () => [contradicting] }),
    );

    expect(result.unmetCriteria).toContain(JUDGED);
    expect(result.voidedAttestations).toContainEqual({
      criterion: JUDGED,
      contradictedBy: "44444444-4444-4444-8444-444444444444",
    });
  });

  it("honours the attestation again once that finding is answered", async () => {
    const answered = finding({
      id: "44444444-4444-4444-8444-444444444444",
      classification: "blocking",
      violates: JUDGED,
      disposition: "fixed",
      dispositionEvidence: "the done-criteria are now each covered by a test",
    });
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict(), attestations: [attestation()] },
      deps({ priorFindings: () => [answered] }),
    );
    expect(result.unmetCriteria).not.toContain(JUDGED);
    expect(result.voidedAttestations ?? []).toEqual([]);
  });

  /**
   * Attestations persist, so round 3 does not have to re-argue what round 1
   * established — and so the record of whose judgement closed a stage outlives the
   * call that made it.
   */
  it("counts an attestation carried over from an earlier round", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict({ round: 2 }) },
      deps({
        priorAttestations: () => [{ ...attestation(), stage: "implement" }],
        metCriteria: () => [],
      }),
    );
    expect(result.unmetCriteria).not.toContain(JUDGED);
  });

  it("ignores an earlier round's attestation made for a DIFFERENT stage", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict() },
      deps({
        priorAttestations: () => [{ ...attestation(), stage: "design" }],
        metCriteria: () => [],
      }),
    );
    expect(result.unmetCriteria).toContain(JUDGED);
  });

  it("returns the attestations of record so the caller can persist what was judged", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict(), attestations: [attestation()] },
      deps({ metCriteria: () => [] }),
    );
    expect(result.attestations).toEqual([{ ...attestation(), stage: "implement" }]);
  });
});

/**
 * DESIGN AND PLAN CRITERIA, DECIDED BY THE ARTIFACT.
 *
 * Seven criteria were undecidable for one reason: the artifacts they describe were
 * free-form narrative, so there was nothing to check against. `plan-dependencies-
 * acyclic` is a graph algorithm that spent this whole time filed as a judgement.
 *
 * Three states, deliberately distinguished — flattening them into "derived or not"
 * is what makes an absent artifact look compliant:
 *
 *   - the record PROVES the criterion → derived, and no claim is needed;
 *   - the record CONTRADICTS it → not derived, and an attestation claiming it is
 *     void, because a claim cannot outvote the artifact it describes;
 *   - the record is SILENT (an empty list) → neither. "This design records no
 *     risks" is a legitimate thing to assert, so it is left to an attestation.
 */
describe("runReviewSubmit — criteria decided by the design and plan records", () => {
  const designRecord = (risks: Record<string, unknown>[]) => ({
    schemaVersion: 1,
    changeSetId: "22222222-2222-4222-8222-222222222222",
    elements: [{ id: "e1", name: "the store", addresses: [] }],
    interfaces: [{ name: "AttestationStore", package: "@crabgic/cli" }],
    risks,
  });

  const planRecord = (tasks: Record<string, unknown>[]) => ({
    schemaVersion: 1,
    changeSetId: "22222222-2222-4222-8222-222222222222",
    tasks,
  });

  function designAttestation(criterion: string) {
    return {
      criterion,
      asserter: "eo-architect",
      rationale: "checked against the risk table",
      artifactAnchor: "docs/design/store.md#risks",
      assertedAt: "2026-07-29T00:00:00.000Z",
      round: 1,
    };
  }

  it("derives the risks and interfaces criteria from a complete design record", async () => {
    const result = await runReviewSubmit(
      {
        stage: "design",
        verdict: verdict({ stage: "design", lens: "contract-fit" }),
        design: designRecord([{ id: "r1", statement: "load spike", mitigation: "bounded retry" }]),
      },
      deps({ metCriteria: () => [] }),
    );

    expect(result.ok).toBe(true);
    expect(result.unmetCriteria).not.toContain("design-risks-have-mitigations");
    expect(result.unmetCriteria).not.toContain("design-interfaces-named");
    // Still open, and correctly so: the acceptance-criteria mapping and the ledger
    // reconciliation are judgements, and nothing has claimed them.
    expect(result.unmetCriteria).toContain("design-addresses-every-acceptance-criterion");
    expect(result.unmetCriteria).toContain("design-reconciled-with-ledger");
  });

  it("withholds the risks criterion when a recorded risk carries no answer", async () => {
    const result = await runReviewSubmit(
      {
        stage: "design",
        verdict: verdict({ stage: "design", lens: "security" }),
        design: designRecord([{ id: "r1", statement: "load spike" }]),
      },
      deps({ metCriteria: () => [] }),
    );
    expect(result.unmetCriteria).toContain("design-risks-have-mitigations");
  });

  /** THE TEETH FOR ARTIFACTS: a claim cannot outvote the record it describes. */
  it("voids an attestation the design record contradicts", async () => {
    const result = await runReviewSubmit(
      {
        stage: "design",
        verdict: verdict({ stage: "design", lens: "security" }),
        design: designRecord([{ id: "r1", statement: "load spike" }]),
        attestations: [designAttestation("design-risks-have-mitigations")],
      },
      deps({ metCriteria: () => [] }),
    );

    expect(result.unmetCriteria).toContain("design-risks-have-mitigations");
    expect(result.voidedAttestations).toContainEqual({
      criterion: "design-risks-have-mitigations",
      contradictedBy: "design-record",
    });
  });

  /**
   * ...but a claim about what the record is SILENT on stands. A design that records
   * no risks has not violated the criterion, and someone has to be able to say so.
   */
  it("honours an attestation about a section the record leaves empty", async () => {
    const result = await runReviewSubmit(
      {
        stage: "design",
        verdict: verdict({ stage: "design", lens: "security" }),
        design: designRecord([]),
        attestations: [designAttestation("design-risks-have-mitigations")],
      },
      deps({ metCriteria: () => [] }),
    );
    expect(result.unmetCriteria).not.toContain("design-risks-have-mitigations");
    expect(result.voidedAttestations ?? []).toEqual([]);
  });

  it("derives done-criteria and acyclicity from a plan record", async () => {
    const result = await runReviewSubmit(
      {
        stage: "plan",
        verdict: verdict({ stage: "plan", lens: "sequencing" }),
        plan: planRecord([
          { id: "t1", statement: "build the store", doneCriteria: ["its tests pass"], covers: ["e1"] },
          {
            id: "t2",
            statement: "wire it up",
            doneCriteria: ["the registry test passes"],
            dependsOn: ["t1"],
            covers: ["e1"],
          },
        ]),
      },
      deps({ metCriteria: () => [] }),
    );

    expect(result.unmetCriteria).not.toContain("plan-tasks-have-done-criteria");
    expect(result.unmetCriteria).not.toContain("plan-dependencies-acyclic");
  });

  it("withholds acyclicity for a cyclic plan — a graph algorithm, not a judgement", async () => {
    const result = await runReviewSubmit(
      {
        stage: "plan",
        verdict: verdict({ stage: "plan", lens: "sequencing" }),
        plan: planRecord([
          { id: "t1", statement: "a", doneCriteria: ["x"], dependsOn: ["t2"] },
          { id: "t2", statement: "b", doneCriteria: ["y"], dependsOn: ["t1"] },
        ]),
      },
      deps({ metCriteria: () => [] }),
    );
    expect(result.unmetCriteria).toContain("plan-dependencies-acyclic");
  });

  /**
   * Coverage is scored against the DESIGN's elements, which come from the record the
   * design stage left behind. Asking the plan whether it covers what it says it
   * covers always answers yes.
   */
  it("scores plan coverage against the stored design record, not the plan's own claims", async () => {
    // Parsed rather than hand-built: `priorDesign` returns what the STORE holds, and
    // the store only ever holds records that validated.
    const stored = DesignRecordSchema.parse(
      designRecord([{ id: "r1", statement: "s", mitigation: "m" }]),
    );
    const uncovering = planRecord([
      { id: "t1", statement: "a", doneCriteria: ["x"], covers: ["something-else"] },
    ]);

    const missing = await runReviewSubmit(
      {
        stage: "plan",
        verdict: verdict({ stage: "plan", lens: "coverage-of-design" }),
        plan: uncovering,
      },
      deps({ metCriteria: () => [], priorDesign: () => stored }),
    );
    expect(missing.unmetCriteria).toContain("plan-covers-every-design-element");

    const covering = planRecord([{ id: "t1", statement: "a", doneCriteria: ["x"], covers: ["e1"] }]);
    const complete = await runReviewSubmit(
      {
        stage: "plan",
        verdict: verdict({ stage: "plan", lens: "coverage-of-design" }),
        plan: covering,
      },
      deps({ metCriteria: () => [], priorDesign: () => stored }),
    );
    expect(complete.unmetCriteria).not.toContain("plan-covers-every-design-element");
  });

  it("refuses a malformed artifact rather than deriving from a document it could not read", async () => {
    const result = await runReviewSubmit(
      {
        stage: "plan",
        verdict: verdict({ stage: "plan", lens: "sequencing" }),
        plan: { schemaVersion: 1, changeSetId: "not-a-uuid", tasks: [] },
      },
      deps(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/plan record/i);
  });

  it("returns the artifacts of record so the caller persists what was judged", async () => {
    const submitted = planRecord([{ id: "t1", statement: "a", doneCriteria: ["x"] }]);
    const result = await runReviewSubmit(
      { stage: "plan", verdict: verdict({ stage: "plan", lens: "sequencing" }), plan: submitted },
      deps({ metCriteria: () => [] }),
    );
    expect(result.planOfRecord?.tasks).toHaveLength(1);
  });
});

/**
 * Self-review of the reporting itself.
 *
 * `unattestedCriteria` exists to tell a caller WHY a criterion it supplied did not
 * count, so the field has to mean one thing. A criterion that is server-derived was
 * never going to count from a bare string and the tool documents that; a criterion
 * that did end up met must not appear at all.
 */
describe("runReviewSubmit — unattestedCriteria means exactly one thing", () => {
  it("does not name a server-derived criterion the caller claimed", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict() },
      deps({
        metCriteria: () => ["implement-gates-pass", "no-open-debt-in-touched-paths"],
      }),
    );
    // Both are decided by the server. Listing them as "unattested" would tell the
    // caller to go and attest something no attestation can establish.
    expect(result.unattestedCriteria).toEqual([]);
  });

  it("does not name a criterion that ended up met after all", async () => {
    const result = await runReviewSubmit(
      {
        stage: "implement",
        verdict: verdict(),
        attestations: [doneCriteriaAttestation()],
      },
      deps({ metCriteria: () => ["implement-task-done-criteria-met"] }),
    );
    expect(result.unattestedCriteria).toEqual([]);
    expect(result.unmetCriteria).not.toContain("implement-task-done-criteria-met");
  });

  /**
   * A stored attestation for a criterion that has SINCE become server-derived must
   * stop counting. The record outlives the rules it was written under, and an old
   * claim silently overriding a new derivation is the derivation running backwards
   * with a delay.
   */
  it("stops honouring a stored attestation once its criterion became server-derived", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict() },
      deps({
        metCriteria: () => [],
        priorAttestations: () => [
          {
            ...doneCriteriaAttestation(),
            criterion: "implement-gates-pass",
            stage: "implement",
          },
        ],
      }),
    );
    expect(result.unmetCriteria).toContain("implement-gates-pass");
  });

  it("stops honouring a stored attestation for a criterion the stage no longer requires", async () => {
    const result = await runReviewSubmit(
      { stage: "implement", verdict: verdict() },
      deps({
        metCriteria: () => [],
        priorAttestations: () => [
          {
            ...doneCriteriaAttestation(),
            criterion: "design-risks-have-mitigations",
            stage: "implement",
          },
        ],
      }),
    );
    expect(result.attestations?.map((entry) => entry.criterion)).not.toContain(
      "design-risks-have-mitigations",
    );
  });
});
